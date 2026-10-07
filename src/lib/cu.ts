import { callAction, extractStores, withStaleFallback } from "./relay";
import { distanceM } from "./distance";
import { isAnniversaryCardPack } from "./constants";
import { PROVINCE_LABELS, SUB_AREAS, type Region } from "./regions";
import type { StoreStock } from "./types";

async function fetchOnce(
  keyword: string,
  storeKeyword: string | null,
  lat: number | null,
  lng: number | null
): Promise<StoreStock[]> {
  const raw = await callAction("cuCheckInventory", {
    keyword,
    size: 100,
    offset: 0,
    searchSort: "recom",
    storeLimit: 300,
    storeKeyword: storeKeyword ?? undefined,
    latitude: lat ?? undefined,
    longitude: lng ?? undefined,
  });
  if (!raw || raw.success === false) {
    const msg = raw && (raw.error || raw.message);
    throw new Error(typeof msg === "string" ? msg : "CU 재고 조회 실패");
  }
  // 매장 객체 안에는 상품명이 없고 nearbyStores.stockItemName 에 실제로 매칭된 상품명이 따로 있다.
  // 검색 키워드가 아니라 이 실제 상품명을 기준으로 30주년 팩인지 판단하고, 펼쳤을 때도 이 이름을 보여준다.
  const actualProductName: unknown = raw?.data?.nearbyStores?.stockItemName;
  const productNameFallback = typeof actualProductName === "string" ? actualProductName : keyword;
  return extractStores(raw, "cu", productNameFallback).filter((s) => isAnniversaryCardPack(s.productName));
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
  const subAreas = SUB_AREAS[region.slug];
  if (region.addressPrefix === null) {
    // 전국: 좌표 반경이 아니라 시/도 이름으로 17번 나눠 돌면서 합친다.
    const tasks = PROVINCE_LABELS.map((label) => fetchOnce(keyword, label, null, null).catch(() => []));
    stores = dedupe((await Promise.all(tasks)).flat());
  } else if (subAreas) {
    // 시/도 이름 하나로 조회하면 ~50개 선에서 캡이 걸려서, 구/군 단위로 쪼개서 각각 조회 후 합친다.
    const single = region.centers[0];
    const tasks = subAreas.map((area) => fetchOnce(keyword, area, single.lat, single.lng).catch(() => []));
    stores = dedupe((await Promise.all(tasks)).flat());
  } else {
    const single = region.centers[0];
    stores = await fetchOnce(keyword, region.addressPrefix, single.lat, single.lng);
  }

  const ref = region.centers[0];
  return stores.map((s) => {
    if (s.lat === null || s.lng === null) return s;
    return { ...s, distanceM: distanceM(ref.lat, ref.lng, s.lat, s.lng) };
  });
}

export function findNearbyStock(keyword: string, region: Region): Promise<{ stores: StoreStock[]; stale: boolean }> {
  const key = `cu:${keyword}:${region.slug}`;
  // relay가 막혔을 때(429) 화면이 비지 않도록, 3분 안에는 캐시를 쓰고 실패하면 마지막 성공값을 보여준다.
  return withStaleFallback(key, 3 * 60 * 1000, () => fetchNearby(keyword, region));
}
