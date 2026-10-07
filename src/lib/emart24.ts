// 이마트24 비공식 웹 엔드포인트. 예고 없이 막힐 수 있다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { distanceM } from "./distance";
import { isNotTransitCard } from "./constants";
import type { Region } from "./regions";
import type { StoreStock } from "./types";

const HEADERS = {
  Accept: "application/json, text/javascript, */*; q=0.01",
  "X-Requested-With": "XMLHttpRequest",
};
const STORES_FILE = "data/emart24-stores.json";
const WEEK = 7 * 24 * 60 * 60 * 1000;

type RawStore = { code: string; name: string; address: string; lat: number; lng: number };
type Product = { pluCd: string; name: string; price: number };

// 이마트24 방화벽은 짧은 시간에 요청이 몰리면 IP를 차단한다. 그래서 요청을 한 줄로 세워 간격을 두고,
// 403을 받으면 한동안 아예 요청하지 않는다.
const GAP_MS = 700;
const COOLDOWN_MS = 30 * 60 * 1000;
let line = Promise.resolve();
let blockedUntil = 0;

export class BlockedError extends Error {}

function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const run = line.then(async () => {
    if (Date.now() < blockedUntil)
      throw new BlockedError("이마트24가 요청을 잠시 막았어요. 30분 뒤에 다시 시도해 주세요.");
    const res = await fetch(url, {
      ...init,
      headers: { ...HEADERS, ...init?.headers },
      signal: AbortSignal.timeout(15000),
    });
    await new Promise((r) => setTimeout(r, GAP_MS));
    if (res.status === 403) {
      blockedUntil = Date.now() + COOLDOWN_MS;
      throw new BlockedError("이마트24가 요청을 잠시 막았어요. 30분 뒤에 다시 시도해 주세요.");
    }
    if (!res.ok) throw new Error(`emart24 ${res.status} ${url}`);
    return res.json() as Promise<T>;
  });
  line = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

type StorePage = {
  count: number;
  data?: { CODE: string; TITLE: string; ADDRESS: string; LATITUDE: string; LONGITUDE: string }[];
};

let storesCache: Promise<RawStore[]> | null = null;
let storesLoadedAt = 0;
function allStores(): Promise<RawStore[]> {
  if (!storesCache || Date.now() - storesLoadedAt > WEEK) {
    storesLoadedAt = Date.now();
    storesCache = loadStores().catch((e) => {
      storesCache = null;
      throw e;
    });
  }
  return storesCache;
}

async function loadStores(): Promise<RawStore[]> {
  try {
    const cached = JSON.parse(await readFile(STORES_FILE, "utf8"));
    if (Date.now() - cached.savedAt < WEEK) return cached.stores;
  } catch {
    // 캐시 없음/만료 — 새로 받는다.
  }

  const page = (n: number) => getJson<StorePage>(`https://emart24.co.kr/api1/store?page=${n}`);
  const first = await page(1);
  const pages = Math.ceil(first.count / (first.data?.length || 40));
  const rows = [...(first.data ?? [])];
  for (let n = 2; n <= pages; n++) rows.push(...((await page(n)).data ?? []));
  const stores = rows
    .map((r) => ({ code: r.CODE, name: r.TITLE, address: r.ADDRESS, lat: +r.LATITUDE, lng: +r.LONGITUDE }))
    .filter((s) => s.code && s.lat && s.lng);

  try {
    await mkdir("data", { recursive: true });
    await writeFile(STORES_FILE, JSON.stringify({ savedAt: Date.now(), stores }));
  } catch {
    // 쓰기 실패해도 조회는 계속 진행 (서버리스 환경 등)
  }
  return stores;
}

let productsCache: { at: number; keyword: string; products: Product[] } | null = null;
async function searchProducts(keyword: string): Promise<Product[]> {
  if (productsCache && productsCache.keyword === keyword && Date.now() - productsCache.at < 6 * 60 * 60 * 1000) {
    return productsCache.products;
  }
  // pageCnt를 크게 줘도 서버가 한 페이지에 10개로 고정해서 끊어버려서, 페이지를 넘기며 끝까지 모은다.
  type SearchRes = { productList?: { pluCd: string; goodsNm: string; viewPrice: number }[]; totalCnt?: number };
  const raw: { pluCd: string; goodsNm: string; viewPrice: number }[] = [];
  let page = 1;
  let totalCnt = Infinity;
  while (raw.length < totalCnt && page <= 10) {
    const body = new URLSearchParams({
      currentPage: String(page),
      pageCnt: "10",
      sortType: "LATEST",
      saleProductYn: "N",
      searchWord: keyword,
    });
    const res = await getJson<SearchRes>("https://everse.emart24.co.kr/stock/stock/search", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    });
    if (!res.productList || res.productList.length === 0) break;
    raw.push(...res.productList);
    // totalCnt는 1페이지 응답에만 들어있고 그 뒤 페이지에서는 비어있어서, 유효한 숫자가 올 때만
    // 갱신한다 — 아니면 빈 값에 덮어씌워져서 페이지네이션이 조기 종료된다.
    if (typeof res.totalCnt === "number" && res.totalCnt > 0) totalCnt = res.totalCnt;
    page++;
  }
  const products = raw.map((p) => ({
    pluCd: p.pluCd,
    name: p.goodsNm.replace(/^포켓몬\)/, ""),
    price: p.viewPrice,
  }));
  productsCache = { at: Date.now(), keyword, products };
  return products;
}

// 실측해보니 한 번에 1000개 매장 코드까지는 받아주고(2000개부턴 URL이 너무 길어져서 414),
// 20개씩 보내던 건 너무 보수적이었다 — 배치를 키워서 요청 횟수를 ~50배 줄인다.
const STOCK_BATCH_SIZE = 700;

async function stockFor(pluCd: string, codes: string[]): Promise<Map<string, number>> {
  const qty = new Map<string, number>();
  for (let i = 0; i < codes.length; i += STOCK_BATCH_SIZE) {
    const res = await getJson<{ storeGoodsQty?: { BIZNO: string; BIZQTY: number }[] }>(
      `https://everse.emart24.co.kr/api/stock/v2/stock-search/store?searchPluCode=${pluCd}&bizNoArr=${codes
        .slice(i, i + STOCK_BATCH_SIZE)
        .join(",")}`
    );
    for (const r of res.storeGoodsQty ?? []) qty.set(r.BIZNO, r.BIZQTY);
  }
  return qty;
}

// 같은 지역을 여러 사람이 동시에 열어도 업스트림을 두드리지 않도록 5분 캐시.
// (요청 한 번에 매장 배치 수 × 상품 수만큼 업스트림을 두드리기 때문에, 캐시를 넉넉히 잡아서
// 재클릭/재조회로 인한 불필요한 요청을 최대한 줄인다.)
const nearbyCache = new Map<string, { at: number; result: Promise<Emart24Result> }>();
// 403으로 막혔을 때도 화면이 비지 않도록, 마지막으로 성공한 결과를 지역별로 들고 있다가 보여준다.
const lastGoodCache = new Map<string, StoreStock[]>();

// 배치 크기를 키운 덕분에(STOCK_BATCH_SIZE) 더 이상 매장 수를 억지로 잘라낼 필요가 없다 —
// 지역에 해당하는 매장을 전부 조회한다. 상품도 "포켓몬카드"로 검색되는 전체(43종 정도)를 다 본다.
const MAX_STORES = Infinity;
const MAX_PRODUCTS = 50;

export interface Emart24Result {
  stores: StoreStock[];
  stale: boolean;
}

export function findNearbyStock(keyword: string, region: Region): Promise<Emart24Result> {
  const key = `${keyword}:${region.slug}`;
  const hit = nearbyCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.result;

  const result = fetchNearby(keyword, region, MAX_STORES).then(
    (stores): Emart24Result => {
      lastGoodCache.set(key, stores);
      return { stores, stale: false };
    },
    (err): Emart24Result => {
      const fallback = lastGoodCache.get(key);
      if (fallback) return { stores: fallback, stale: true };
      throw err;
    }
  );
  nearbyCache.set(key, { at: Date.now(), result });
  result.catch(() => nearbyCache.delete(key));
  return result;
}

// 이마트24 매장 데이터에 "전남광주통합특별시"라는 실존하지 않는 행정구역명이 섞여 있어서
// (광주 5개 구 + 전남 시/군이 전부 이 이름 하나로 묶여 있음), 두 번째 토큰(구/시/군)으로
// 광주인지 전남인지 다시 구분한다.
const GWANGJU_GU = ["동구", "서구", "남구", "북구", "광산구"];
function effectiveAddressPrefix(address: string): string {
  if (!address.startsWith("전남광주통합특별시")) return address;
  const rest = address.slice("전남광주통합특별시".length).trim();
  const secondToken = rest.split(" ")[0] ?? "";
  return GWANGJU_GU.includes(secondToken) ? `광주광역시 ${rest}` : `전라남도 ${rest}`;
}

async function fetchNearby(keyword: string, region: Region, maxStores: number): Promise<StoreStock[]> {
  const ref = region.centers[0];
  const filtered = (await allStores())
    .filter((store) => !region.addressPrefix || effectiveAddressPrefix(store.address).startsWith(region.addressPrefix))
    .map((store) => ({ store, dist: distanceM(ref.lat, ref.lng, store.lat, store.lng) }))
    .sort((a, b) => a.dist - b.dist);
  if (filtered.length === 0) return [];

  // 이마트24는 30주년 상품이 카탈로그에 없어서(GS25와 동일 상황), "30주년" 포함 여부로 거르지
  // 않고 "포켓몬 카드"류 전체를 넓게 찾는다 — 빵/초코케익 같은 포켓몬 콜라보 과자나 교통카드는
  // 제외한다.
  const products = (await searchProducts(keyword))
    .filter((p) => p.name.includes("카드"))
    .filter((p) => isNotTransitCard(p.name))
    .slice(0, MAX_PRODUCTS);

  // 이마트24 카탈로그에 30주년 상품이 아직 없어 검색이 안 맞을 땐, 매장별 재고를 업스트림에
  // 추가로 두드릴 필요가 없으니 이미 캐시된 전체 매장 목록을 개수 제한 없이 다 보여준다.
  if (products.length === 0) {
    return filtered.map(({ store, dist }) => ({
      brand: "emart24",
      storeName: store.name,
      address: store.address,
      lat: store.lat,
      lng: store.lng,
      distanceM: dist,
      productName: "포켓몬카드 30주년 셀레브레이션 (미취급)",
      qty: null,
      inStock: false,
    }));
  }

  // 실제 재고를 매장마다 업스트림에 물어봐야 하는 경로라, 차단 방지를 위해 여기서만 개수를 제한한다.
  const near = filtered.slice(0, maxStores);
  const codes = near.map((s) => s.store.code);
  const qtyByProduct: Map<string, number>[] = [];
  for (const p of products) qtyByProduct.push(await stockFor(p.pluCd, codes));

  const out: StoreStock[] = [];
  near.forEach(({ store, dist }) => {
    products.forEach((p, i) => {
      const qty = qtyByProduct[i].get(store.code) ?? 0;
      out.push({
        brand: "emart24",
        storeName: store.name,
        address: store.address,
        lat: store.lat,
        lng: store.lng,
        distanceM: dist,
        productName: p.name,
        qty,
        inStock: qty > 0,
      });
    });
  });
  return out;
}
