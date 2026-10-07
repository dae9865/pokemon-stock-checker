export interface Region {
  slug: string;
  label: string;
  // 지역명 매칭용 (도로명주소 접두사) — 이마트24 주소 필터, CU/세븐일레븐 storeKeyword
  addressPrefix: string | null; // null = 전국(필터 없음)
  // GS25 좌표 기반 조회용 중심점들 (전국은 여러 지점을 합쳐서 커버한다)
  centers: { lat: number; lng: number; radius: number }[];
}

export const REGIONS: Region[] = [
  {
    slug: "all",
    label: "전국",
    addressPrefix: null,
    centers: [
      { lat: 37.5665, lng: 126.978, radius: 20000 }, // 서울
      { lat: 37.4138, lng: 127.5183, radius: 40000 }, // 경기
      { lat: 37.4563, lng: 126.7052, radius: 20000 }, // 인천
      { lat: 35.1796, lng: 129.0756, radius: 20000 }, // 부산
      { lat: 35.8714, lng: 128.6014, radius: 15000 }, // 대구
      { lat: 35.1595, lng: 126.8526, radius: 15000 }, // 광주
      { lat: 36.3504, lng: 127.3845, radius: 15000 }, // 대전
      { lat: 35.5384, lng: 129.3114, radius: 15000 }, // 울산
      { lat: 36.4801, lng: 127.289, radius: 10000 }, // 세종
      { lat: 37.8228, lng: 128.1555, radius: 40000 }, // 강원
      { lat: 36.6357, lng: 127.4917, radius: 35000 }, // 충북
      { lat: 36.6588, lng: 126.6728, radius: 35000 }, // 충남
      { lat: 35.8242, lng: 127.148, radius: 35000 }, // 전북
      { lat: 34.8161, lng: 126.4629, radius: 40000 }, // 전남
      { lat: 36.4919, lng: 128.8889, radius: 45000 }, // 경북
      { lat: 35.2375, lng: 128.6922, radius: 35000 }, // 경남
      { lat: 33.4996, lng: 126.5312, radius: 25000 }, // 제주
    ],
  },
  { slug: "seoul", label: "서울", addressPrefix: "서울", centers: [{ lat: 37.5665, lng: 126.978, radius: 20000 }] },
  { slug: "gyeonggi", label: "경기", addressPrefix: "경기", centers: [{ lat: 37.4138, lng: 127.5183, radius: 40000 }] },
  { slug: "incheon", label: "인천", addressPrefix: "인천", centers: [{ lat: 37.4563, lng: 126.7052, radius: 20000 }] },
  { slug: "busan", label: "부산", addressPrefix: "부산", centers: [{ lat: 35.1796, lng: 129.0756, radius: 20000 }] },
  { slug: "daegu", label: "대구", addressPrefix: "대구", centers: [{ lat: 35.8714, lng: 128.6014, radius: 15000 }] },
  { slug: "gwangju", label: "광주", addressPrefix: "광주", centers: [{ lat: 35.1595, lng: 126.8526, radius: 15000 }] },
  { slug: "daejeon", label: "대전", addressPrefix: "대전", centers: [{ lat: 36.3504, lng: 127.3845, radius: 15000 }] },
  { slug: "ulsan", label: "울산", addressPrefix: "울산", centers: [{ lat: 35.5384, lng: 129.3114, radius: 15000 }] },
  { slug: "sejong", label: "세종", addressPrefix: "세종", centers: [{ lat: 36.4801, lng: 127.289, radius: 10000 }] },
  { slug: "gangwon", label: "강원", addressPrefix: "강원", centers: [{ lat: 37.8228, lng: 128.1555, radius: 40000 }] },
  // 충북/충남/전남/경북/경남은 실제 도로명주소가 "충청북도" 같은 정식 명칭으로 시작해서,
  // 줄임말("충북")로는 이마트24의 startsWith 매칭이 전혀 안 걸렸다 — 정식 명칭으로 고쳤다.
  { slug: "chungbuk", label: "충북", addressPrefix: "충청북도", centers: [{ lat: 36.6357, lng: 127.4917, radius: 35000 }] },
  { slug: "chungnam", label: "충남", addressPrefix: "충청남도", centers: [{ lat: 36.6588, lng: 126.6728, radius: 35000 }] },
  { slug: "jeonbuk", label: "전북", addressPrefix: "전북", centers: [{ lat: 35.8242, lng: 127.148, radius: 35000 }] },
  { slug: "jeonnam", label: "전남", addressPrefix: "전라남도", centers: [{ lat: 34.8161, lng: 126.4629, radius: 40000 }] },
  { slug: "gyeongbuk", label: "경북", addressPrefix: "경상북도", centers: [{ lat: 36.4919, lng: 128.8889, radius: 45000 }] },
  { slug: "gyeongnam", label: "경남", addressPrefix: "경상남도", centers: [{ lat: 35.2375, lng: 128.6922, radius: 35000 }] },
  { slug: "jeju", label: "제주", addressPrefix: "제주", centers: [{ lat: 33.4996, lng: 126.5312, radius: 25000 }] },
];

export function getRegion(slug: string): Region {
  return REGIONS.find((r) => r.slug === slug) ?? REGIONS[0];
}

// CU/세븐일레븐 relay는 좌표 기반 조회가 없고 storeKeyword(지역명 텍스트)로만 좁힐 수 있어서,
// "전국" 조회 시에는 이 17개 시/도 이름으로 나눠서 각각 조회한 뒤 합친다.
export const PROVINCE_LABELS: string[] = REGIONS.filter((r) => r.slug !== "all").map((r) => r.addressPrefix!);

// CU relay는 storeKeyword 하나당 매장을 ~50개 선에서 캡 걸어버린다(좌표를 바꿔도 동일 결과였음,
// 실측 확인함) — 그래서 "서울" 하나로 통째로 조회하면 실제 수백~수천 개 매장 중 50여 개만
// 보인다. 구 단위로 쪼개서 여러 번 조회하면 각각 별도로 캡이 걸려서 합치면 훨씬 더 많이 잡힌다.
// 당장은 가장 많이 조회되는 서울만 추가했고, 다른 지역도 필요하면 여기에 추가하면 된다.
export const SUB_AREAS: Partial<Record<string, string[]>> = {
  seoul: [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구", "성북구", "강북구", "도봉구",
    "노원구", "은평구", "서대문구", "마포구", "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구",
    "관악구", "서초구", "강남구", "송파구", "강동구",
  ],
};
