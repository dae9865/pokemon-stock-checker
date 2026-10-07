export type Brand = "gs25" | "cu" | "seveneleven" | "emart24";

export interface StoreStock {
  brand: Brand;
  storeName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  distanceM: number | null;
  productName: string;
  qty: number | null;
  inStock: boolean;
  // false면 inStock/qty를 신뢰할 수 없는 데이터 소스(예: GS25 relay 장애)에서 온 것 — UI에서
  // "품절"/"재고 있음" 대신 "재고 확인 불가"로 보여줘야 한다. 생략하면 true(신뢰 가능)로 취급한다.
  stockKnown?: boolean;
  // 이 매장+상품의 qty/inStock이 마지막으로 바뀐 시각(epoch ms). 서버가 과거에 이 조합을
  // 본 적이 없으면 이번 조회 시각으로 채워진다(최초 관측 = 기준점).
  changedAt?: number | null;
}

export interface BrandResult {
  brand: Brand;
  ok: boolean;
  error?: string;
  stale?: boolean;
  stores: StoreStock[];
}
