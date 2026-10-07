import type { Region } from "./regions";
import type { StoreStock } from "./types";
import { isNotTransitCard } from "./constants";

const HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  Origin: "https://woodongs.com",
  Referer: "https://woodongs.com/",
};

const SEARCH_URL = "https://b2c-apigw.woodongs.com/search/v3/totalSearch";
const DIRECT_STOCK_URL = "https://b2c-bff.woodongs.com/api/bff/v2/store/stock";
const RELAY_STOCK_URL = "https://mcp.aka.page/api/gs25/inventory";

interface ItemHit {
  itemName: string;
  itemCode: string;
}

// totalSearch 응답 구조가 문서화되어 있지 않아, itemName/itemCode 쌍이 나올 때까지
// 재귀적으로 훑는다.
function extractItems(node: unknown, out: ItemHit[], seen: Set<string>): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) extractItems(child, out, seen);
    return;
  }
  const obj = node as Record<string, unknown>;
  const itemName = obj.itemName ?? obj.goodsNm;
  const itemCode = obj.itemCode ?? obj.goodsCd;
  if (typeof itemName === "string" && typeof itemCode === "string" && !seen.has(itemCode)) {
    seen.add(itemCode);
    out.push({ itemName, itemCode });
  }
  for (const value of Object.values(obj)) extractItems(value, out, seen);
}

export async function searchItems(keyword: string): Promise<ItemHit[]> {
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { ...HEADERS, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ query: keyword }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GS25 상품 검색 실패 (HTTP ${res.status})`);
  const data = await res.json();
  const out: ItemHit[] = [];
  extractItems(data, out, new Set());
  return out;
}

interface RawStore {
  storeName?: string;
  storeNm?: string;
  address?: string;
  roadAddress?: string;
  latitude?: number | string;
  longitude?: number | string;
  itemQty?: number | string;
  stockQty?: number | string;
  realStockQuantity?: number | string;
  isSoldOut?: boolean;
  distance?: number | string;
  distanceM?: number | string;
}

async function getDirectStock(
  itemCode: string,
  lat: number,
  lng: number,
  radius: number
): Promise<RawStore[]> {
  const params = new URLSearchParams({
    serviceCode: "01",
    itemCode,
    myPositionXCoordination: String(lng),
    myPositionYCoordination: String(lat),
    centerPositionXCoordination: String(lng),
    centerPositionYCoordination: String(lat),
    radiusCondition: String(radius),
    pickupStoreYn: "N",
    realTimeStockYn: "Y",
    isSuperDlvyStoreSelected: "N",
    isGs25DlvyStoreSelected: "N",
    pageNumber: "0",
    pageCount: "300",
  });
  const res = await fetch(`${DIRECT_STOCK_URL}?${params}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`GS25 direct API 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return (data.stores ?? []) as RawStore[];
}

async function getRelayStock(itemCode: string, lat: number, lng: number): Promise<RawStore[]> {
  const params = new URLSearchParams({
    itemCode,
    lat: String(lat),
    lng: String(lng),
    storeLimit: "300",
  });
  const res = await fetch(`${RELAY_STOCK_URL}?${params}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`GS25 relay API 실패 (HTTP ${res.status})`);
  const data = await res.json();
  if (data.success === false) throw new Error("GS25 relay 응답 실패");
  // relay 응답은 {success, data: {inventory: {stores: [...]}}} 형태로 한 겹 더 감싸져 있다.
  return (data.data?.inventory?.stores ?? data.inventory?.stores ?? data.stores ?? []) as RawStore[];
}

async function getStoresForItem(
  itemCode: string,
  itemName: string,
  lat: number,
  lng: number,
  radius: number
): Promise<StoreStock[]> {
  let raw: RawStore[];
  let viaDirect: boolean;
  try {
    raw = await getDirectStock(itemCode, lat, lng, radius);
    viaDirect = true; // 공식 직접 API (지금은 403으로 거의 항상 실패해서 relay로 빠짐)
  } catch {
    raw = await getRelayStock(itemCode, lat, lng);
    viaDirect = false;
  }

  // relay 경로는 상품코드를 무시하고 매번 똑같은 값을 주는 경우가 확인됐지만(신뢰도 낮음),
  // 사용자가 "틀리더라도 숫자를 보여달라"고 요청해서 값은 그대로 보여주고 stockKnown만
  // false로 표시해 화면에서 "부정확할 수 있음" 경고를 띄우는 근거로 쓴다.
  return raw.map((s) => {
    const sLat = s.latitude !== undefined ? Number(s.latitude) : null;
    const sLng = s.longitude !== undefined ? Number(s.longitude) : null;
    const qtyRaw = s.realStockQuantity ?? s.itemQty ?? s.stockQty;
    const qty = qtyRaw !== undefined ? Number(qtyRaw) : null;
    const dist = s.distanceM !== undefined ? Number(s.distanceM) : s.distance !== undefined ? Number(s.distance) : null;
    return {
      brand: "gs25" as const,
      storeName: s.storeName ?? s.storeNm ?? "GS25",
      address: s.roadAddress ?? s.address ?? "",
      lat: sLat,
      lng: sLng,
      distanceM: dist,
      productName: itemName,
      qty,
      inStock: s.isSoldOut !== undefined ? !s.isSoldOut : (qty ?? 0) > 0,
      stockKnown: viaDirect,
    };
  });
}

export async function findNearbyStock(keyword: string, region: Region): Promise<StoreStock[]> {
  const items = (await searchItems(keyword))
    .filter((i) => i.itemName.includes("포켓몬"))
    .filter((i) => isNotTransitCard(i.itemName));
  if (items.length === 0) return [];
  // 예전엔 25개까지 넓혔었는데, GS25 relay 데이터는 어차피 신뢰할 수 없는 상태라 그 넓은 범위가
  // CU/세븐일레븐과 공유하는 relay 요청 한도만 거의 다 써버려서 멀쩡한 CU/세븐일레븐까지
  // 차단당하게 만들었다. 다시 줄여서 한도를 아낀다.
  const topItems = items.slice(0, 5);

  const tasks: Promise<StoreStock[]>[] = [];
  for (const center of region.centers) {
    for (const item of topItems) {
      tasks.push(
        getStoresForItem(item.itemCode, item.itemName, center.lat, center.lng, center.radius).catch(() => [])
      );
    }
  }
  const results = await Promise.all(tasks);
  const all = results.flat();

  // 매장+상품 기준 중복 제거 (여러 중심점 반경이 겹칠 수 있음)
  const seen = new Set<string>();
  const dedup: StoreStock[] = [];
  for (const s of all) {
    const key = `${s.storeName}|${s.address}|${s.productName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(s);
  }
  return dedup;
}
