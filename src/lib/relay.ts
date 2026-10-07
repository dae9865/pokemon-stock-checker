// mcp.aka.page 는 CU/세븐일레븐/GS25 재고조회를 대신 중계해주는 커뮤니티 서비스.
// 공식 API가 아니라서 예고 없이 바뀌거나 막힐 수 있다.
import type { Brand, StoreStock } from "./types";

const ACTION_URL = "https://mcp.aka.page/api/actions/query";
const TIMEOUT_MS = 25000;
const GAP_MS = 250;
const COOLDOWN_MS = 2 * 60 * 1000;

// relay가 429(너무 많은 요청)를 주면 한동안 아예 다시 두드리지 않는다 — 이미 막혀있는데
// 계속 재시도하면 더 오래 막힐 수 있다. 전국 조회(17개 지역 반복 호출)가 몰릴 때 자주 터진다.
let blockedUntil = 0;
let queue = Promise.resolve();

export class RelayBlockedError extends Error {}

export function callAction(actionName: string, params: Record<string, unknown>): Promise<any> {
  const run = queue.then(async () => {
    if (Date.now() < blockedUntil) {
      throw new RelayBlockedError("relay가 요청이 너무 많아 잠시 막았어요. 잠시 후 다시 시도해 주세요.");
    }
    const url = new URL(ACTION_URL);
    url.searchParams.set("action", actionName);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        url.searchParams.set(key, String(value));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error("API가 JSON을 반환하지 않았습니다.");
      }
      if (res.status === 429) {
        blockedUntil = Date.now() + COOLDOWN_MS;
        throw new RelayBlockedError("relay가 요청이 너무 많아 잠시 막았어요. 잠시 후 다시 시도해 주세요.");
      }
      if (!res.ok) {
        const msg = data && (data.error || data.message);
        throw new Error(typeof msg === "string" ? msg : `HTTP ${res.status}`);
      }
      if (data === null || data === undefined) {
        throw new Error("API 응답이 비어 있습니다.");
      }
      return data;
    } finally {
      clearTimeout(timer);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  });
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

// CU/세븐일레븐 공용 — 지역별 조회 결과를 잠깐 캐시해두고, relay가 막혔을 때는 마지막으로
// 성공한 결과를 stale 표시와 함께 보여줘서 화면이 비지 않게 한다 (이마트24와 같은 패턴).
const nearbyCache = new Map<string, { at: number; result: Promise<{ stores: StoreStock[]; stale: boolean }> }>();
const lastGoodCache = new Map<string, StoreStock[]>();

export function withStaleFallback(
  cacheKey: string,
  ttlMs: number,
  fetcher: () => Promise<StoreStock[]>
): Promise<{ stores: StoreStock[]; stale: boolean }> {
  const hit = nearbyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlMs) return hit.result;

  const result = fetcher().then(
    (stores): { stores: StoreStock[]; stale: boolean } => {
      lastGoodCache.set(cacheKey, stores);
      return { stores, stale: false };
    },
    (err): { stores: StoreStock[]; stale: boolean } => {
      const fallback = lastGoodCache.get(cacheKey);
      if (fallback) return { stores: fallback, stale: true };
      throw err;
    }
  );
  nearbyCache.set(cacheKey, { at: Date.now(), result });
  result.catch(() => nearbyCache.delete(cacheKey));
  return result;
}

const QUANTITY_KEYS = [
  "quantity",
  "qty",
  "stock",
  "stockQty",
  "stockQuantity",
  "remainQty",
  "inventoryQty",
  "availableQty",
  "cnt",
  "count",
  "잔여수량",
  "재고수량",
  "수량",
];
const STATUS_KEYS = ["stockStatus", "inventoryStatus", "status", "soldOut", "isSoldOut", "available", "isAvailable"];
const NAME_KEYS = ["storeName", "storeNm", "shopName"];
const ADDR_KEYS = ["address", "roadAddress"];
const CODE_KEYS = ["storeCode", "storeCd", "bizNo"];
const LAT_KEYS = ["latitude", "lat"];
const LNG_KEYS = ["longitude", "lng"];
const PRODUCT_NAME_KEYS = ["goodsNm", "itemName", "productName", "name"];

function findFirst(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  }
  return undefined;
}

function looksLikeStore(obj: Record<string, unknown>): boolean {
  return findFirst(obj, NAME_KEYS) !== undefined && (findFirst(obj, CODE_KEYS) !== undefined || findFirst(obj, ADDR_KEYS) !== undefined);
}

function collectStoreObjects(node: unknown, depth: number, out: Record<string, unknown>[]): void {
  if (depth > 10 || !node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectStoreObjects(child, depth + 1, out);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (looksLikeStore(obj)) {
    out.push(obj);
    return;
  }
  for (const value of Object.values(obj)) collectStoreObjects(value, depth + 1, out);
}

function toBool(val: unknown): boolean | null {
  if (val === undefined || val === null) return null;
  if (typeof val === "boolean") return val;
  const s = String(val).toLowerCase();
  if (["y", "true", "1", "soldout", "품절"].includes(s)) return s === "y" || s === "true" || s === "1" ? true : false;
  return null;
}

export function extractStores(raw: any, brand: Brand, productNameFallback: string): StoreStock[] {
  const found: Record<string, unknown>[] = [];
  collectStoreObjects(raw, 0, found);

  const seen = new Set<string>();
  const out: StoreStock[] = [];
  for (const obj of found) {
    const name = String(findFirst(obj, NAME_KEYS) ?? "");
    const address = String(findFirst(obj, ADDR_KEYS) ?? "");
    const code = findFirst(obj, CODE_KEYS);
    const dedupeKey = code !== undefined ? String(code) : `${name}|${address}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const qtyRaw = findFirst(obj, QUANTITY_KEYS);
    const qty = qtyRaw !== undefined ? Number(qtyRaw) : null;
    const statusRaw = findFirst(obj, STATUS_KEYS);
    const soldOut = toBool(statusRaw);
    const productName = String(findFirst(obj, PRODUCT_NAME_KEYS) ?? productNameFallback);

    const latRaw = findFirst(obj, LAT_KEYS);
    const lngRaw = findFirst(obj, LNG_KEYS);

    // 세븐일레븐처럼 정확한 수량 대신 -1(실시간 수량 미제공)을 보내는 경우가 있다.
    // soldOut:false 플래그만으로 "재고 있음"이라 단정하면 실제로는 대부분 품절인데 재고 있다고
    // 잘못 알려주는 경우가 더 많다고 사용자가 직접 확인해줬다 — 그래서 정확한 수량이 없으면
    // 그냥 품절로 취급한다(숫자가 확인된 경우만 재고 있음으로 본다).
    const hasRealQty = qty !== null && qty >= 0;
    out.push({
      brand,
      storeName: name || brand,
      address,
      lat: latRaw !== undefined ? Number(latRaw) : null,
      lng: lngRaw !== undefined ? Number(lngRaw) : null,
      distanceM: null,
      productName,
      qty: hasRealQty ? qty : null,
      inStock: hasRealQty ? qty! > 0 : false,
      stockKnown: true,
    });
  }
  return out;
}
