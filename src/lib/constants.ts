import type { Brand } from "./types";

// CU/세븐일레븐/이마트24는 상품명에 "30주년"이 들어가 있어서 이걸로 정확히 골라낼 수 있다.
// 단, "포켓몬 교통카드 30주년"(이즈 교통카드) 같은 완전히 다른 상품도 "30주년"이 들어가서
// 같이 걸리기 때문에, 우리가 찾는 트레이딩카드 팩이 아닌 교통카드류는 명시적으로 제외한다.
// GS25는 아직 30주년 상품이 카탈로그에 없어서(gs25.ts) 이 필터를 적용하지 않고 "포켓몬카드"가
// 들어가는 모든 상품을 보여준다.
// "IC칩"은 포켓몬 교통카드(다이어리 등 부착형 포함) 상품에 공통으로 붙는 표기라 함께 제외한다.
// 아래는 GS25에서 "포켓몬카드"로 넓게 검색할 때 같이 걸리는, 30주년 셀레브레이션 팩이 아닌
// 다른 포켓몬 TCG 확장팩/부속상품들(사용자가 직접 확인해서 제외 요청).
const EXCLUDE_KEYWORDS = [
  "교통카드",
  "교통 카드",
  "IC칩",
  "OC칩",
  "카드게임3000",
  "카드2탄",
  "카드1탄",
  "캐시비",
  "랜덤",
];

function isExcludedProduct(productName: string): boolean {
  return EXCLUDE_KEYWORDS.some((kw) => productName.includes(kw));
}

export function isAnniversaryCardPack(productName: string): boolean {
  if (!productName.includes("30주년")) return false;
  return !isExcludedProduct(productName);
}

// GS25는 30주년 상품이 카탈로그에 없어 "30주년" 포함 여부로 거르지 않고 넓게 보여주는데,
// 그 대신 교통카드류(IC칩 등)만 명시적으로 빼낸다.
export function isNotTransitCard(productName: string): boolean {
  return !isExcludedProduct(productName);
}

// 편의점마다 상품명이 달라서, "포켓몬" 같은 넓은 키워드로는 검색 엔진이 전혀 다른 상품(교통카드,
// 과자 등)을 더 관련도 높게 띄워버린다. 그래서 체인별로 실제 상품명에 맞춘 키워드를 기본값으로 쓴다.
// - CU: "포켓몬)30주년기념카드" — 정확히 일치시켜야 exact_match로 진짜 재고가 잡힌다.
// - 세븐일레븐: "비젼)포켓몬확장팩(30주년)_H" — 원래 "포켓몬확장팩"으로 느슨하게 찾았는데,
//   세븐일레븐에 "포켓몬확장팩(스톰에메랄다)" 같은 다른 확장팩이 새로 들어오면서 느슨한 검색어가
//   그쪽으로 먼저 매칭돼버려 30주년 재고가 전부 0으로 잡히는 문제가 생겨서, CU처럼 정확한
//   풀네임으로 고정했다.
// - 이마트24: 아직 30주년 상품이 없어서(사용자 확인) "포켓몬카드"로 넓게 찾고 교통카드/과자류는
//   걸러낸다. "포켓몬"으로만 검색하면 빵/초코케익 같은 콜라보 과자가 카드보다 더 관련도 높게
//   나와서 정작 카드 상품(테라스탈페스타 등)이 결과에 안 잡히는 문제가 있었다.
// - GS25: 아직 30주년 상품이 카탈로그에 없어서 "포켓몬카드"로 넓게 찾는다(필터 없음).
export const BRAND_KEYWORDS: Record<Brand, string> = {
  gs25: "포켓몬카드",
  cu: "포켓몬)30주년기념카드",
  seveneleven: "비젼)포켓몬확장팩(30주년)_H",
  emart24: "포켓몬카드",
};
