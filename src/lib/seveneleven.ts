import { callAction, extractStores, withStaleFallback } from "./relay";
import { distanceM } from "./distance";
import { isAnniversaryCardPack } from "./constants";
import { PROVINCE_LABELS, type Region } from "./regions";
import type { StoreStock } from "./types";

async function fetchOnce(keyword: string, storeKeyword: string | null): Promise<StoreStock[]> {
  const raw = await callAction("sevenelevenCheckInventory", {
    keyword,
    storeLimit: 300,
    storeKeyword: storeKeyword ?? undefined,
  });
  if (!raw || raw.success === false) {
    const msg = raw && (raw.error || raw.message);
    throw new Error(typeof msg === "string" ? msg : "세븐일레븐 재고 조회 실패");
  }
  // 매장 객체 안에는 상품명이 없고 product.itemName 에 실제로 매칭된 상품명이 따로 있다.
  // 검색 키워드가 아니라 이 실제 상품명을 기준으로 30주년 팩인지 판단하고, 펼쳤을 때도 이 이름을 보여준다.
  const actualProductName: unknown = raw?.data?.product?.itemName;
  const productNameFallback = typeof actualProductName === "string" ? actualProductName : keyword;
  return extractStores(raw, "seveneleven", productNameFallback).filter((s) => isAnniversaryCardPack(s.productName));
}

function dedupe(stores: StoreStock[]): StoreStock[] {
  const seen = new Set<string>();
  const out: StoreStock[] = [];
  for (const s of stores) {
    const key = `${s.storeName}|${s.address}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

async function fetchNearby(keyword: string, region: Region): Promise<StoreStock[]> {
  let stores: StoreStock[];
  if (region.addressPrefix === null) {
    // 전국: 좌표 조회가 없는 API라 시/도 이름으로 17번 나눠 돌면서 합친다.
    const tasks = PROVINCE_LABELS.map((label) => fetchOnce(keyword, label).catch(() => []));
    stores = dedupe((await Promise.all(tasks)).flat());
  } else {
    stores = await fetchOnce(keyword, region.addressPrefix);
  }

  const ref = region.centers[0];
  return stores.map((s) => {
    if (s.lat === null || s.lng === null) return s;
    return { ...s, distanceM: distanceM(ref.lat, ref.lng, s.lat, s.lng) };
  });
}

export function findNearbyStock(keyword: string, region: Region): Promise<{ stores: StoreStock[]; stale: boolean }> {
  const key = `seveneleven:${keyword}:${region.slug}`;
  // relay가 막혔을 때(429) 화면이 비지 않도록, 3분 안에는 캐시를 쓰고 실패하면 마지막 성공값을 보여준다.
  return withStaleFallback(key, 3 * 60 * 1000, () => fetchNearby(keyword, region));
}
