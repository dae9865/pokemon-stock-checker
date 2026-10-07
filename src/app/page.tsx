"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { REGIONS } from "@/lib/regions";
import type { Brand, BrandResult, StoreStock } from "@/lib/types";

const BRAND_LABEL: Record<Brand, string> = {
  gs25: "GS25",
  cu: "CU",
  seveneleven: "세븐일레븐",
  emart24: "이마트24",
};

const BRAND_DOT: Record<Brand, string> = {
  gs25: "bg-sky-400",
  cu: "bg-purple-400",
  seveneleven: "bg-orange-400",
  emart24: "bg-emerald-400",
};

const BRAND_BADGE: Record<Brand, string> = {
  gs25: "bg-sky-500/15 text-sky-300",
  cu: "bg-purple-500/15 text-purple-300",
  seveneleven: "bg-orange-500/15 text-orange-300",
  emart24: "bg-emerald-500/15 text-emerald-300",
};

const ALL_BRANDS: Brand[] = ["gs25", "cu", "seveneleven", "emart24"];

interface StoreGroup {
  key: string;
  brand: Brand;
  storeName: string;
  address: string;
  distanceM: number | null;
  hasStock: boolean;
  // 모든 매칭 상품의 재고 상태를 신뢰할 수 없는 경우(예: GS25 relay 장애) — "품절"이 아니라
  // "재고 확인 불가"로 보여준다.
  stockUnknown: boolean;
  // 이 매장의 매칭 상품들 중 재고 상태가 가장 최근에 바뀐 시각 — "n분 전 입고" 표시에 쓴다.
  latestChangedAt: number | null;
  items: StoreStock[];
}

// 재고 상태가 이보다 최근에 바뀐 매장은 "방금 입고" 배지를 띄운다.
const RECENT_MS = 10 * 60 * 1000;

function formatAgo(epochMs: number, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - epochMs) / 1000));
  if (diffSec < 60) return "방금";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  return `${Math.floor(diffHour / 24)}일 전`;
}

// 데이터 자체가 전혀 없는 경우(세븐일레븐 수량 모름 등)만 "확인 불가"로 본다.
// GS25처럼 stockKnown=false여도 숫자/품절 값이 실제로 들어있으면 "부정확할 수 있는 값"으로
// 취급해 그대로 보여준다(경고만 별도 표시).
function isTrulyUnknown(s: StoreStock): boolean {
  return s.stockKnown === false && s.qty === null && !s.inStock;
}

function groupByStore(stores: StoreStock[]): StoreGroup[] {
  const map = new Map<string, StoreGroup>();
  for (const s of stores) {
    const key = `${s.brand}|${s.storeName}|${s.address}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(s);
      if (s.inStock) existing.hasStock = true;
      if (!isTrulyUnknown(s)) existing.stockUnknown = false;
      if (s.changedAt && (existing.latestChangedAt ?? 0) < s.changedAt) existing.latestChangedAt = s.changedAt;
    } else {
      map.set(key, {
        key,
        brand: s.brand,
        storeName: s.storeName,
        address: s.address,
        distanceM: s.distanceM,
        hasStock: s.inStock,
        stockUnknown: isTrulyUnknown(s),
        latestChangedAt: s.changedAt ?? null,
        items: [s],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.hasStock !== b.hasStock) return a.hasStock ? -1 : 1;
    if (a.stockUnknown !== b.stockUnknown) return a.stockUnknown ? 1 : -1;
    const da = a.distanceM ?? Infinity;
    const db = b.distanceM ?? Infinity;
    return da - db;
  });
}

const HAS_PRODUCT_IMAGE = true;

function ProductThumb() {
  const [broken, setBroken] = useState(false);
  if (HAS_PRODUCT_IMAGE && !broken) {
    return (
      <img
        src="/product.png"
        alt="포켓몬카드 30주년 셀레브레이션"
        className="w-full h-full object-contain bg-white p-1"
        onError={() => setBroken(true)}
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-amber-200 to-amber-400">
      <svg viewBox="0 0 24 24" className="w-10 h-10 text-amber-700/70" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <circle cx="12" cy="10" r="3.2" />
        <path d="M8.5 16h7" />
      </svg>
    </div>
  );
}

export default function Home() {
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("all");
  const [brands, setBrands] = useState<Brand[]>(["gs25"]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<BrandResult[] | null>(null);
  const [onlyInStock, setOnlyInStock] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const fetchStock = useCallback(
    async (regionSlug: string) => {
      setLoading(true);
      setRegion(regionSlug);
      try {
        const kw = keyword.trim();
        const res = await fetch(`/api/stock?region=${regionSlug}${kw ? `&keyword=${encodeURIComponent(kw)}` : ""}`);
        const data = await res.json();
        setResults(data.results ?? null);
        setLastFetchedAt(Date.now());
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    },
    [keyword]
  );

  // 상대 시각("n분 전") 라벨을 계속 최신으로 유지하기 위한 틱 — 네트워크 요청은 없다.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  // 편의점은 한 번에 하나만 볼 수 있게 — 누르면 그 편의점으로 완전히 교체한다.
  const selectBrand = (b: Brand) => setBrands([b]);

  const groups = useMemo(() => {
    if (!results) return [];
    const all = results.flatMap((r) => r.stores).filter((s) => brands.includes(s.brand));
    const grouped = groupByStore(all);
    return onlyInStock ? grouped.filter((g) => g.hasStock) : grouped;
  }, [results, onlyInStock, brands]);

  const inStockCount = useMemo(() => {
    if (!results) return 0;
    const all = results.flatMap((r) => r.stores).filter((s) => brands.includes(s.brand));
    return groupByStore(all).filter((g) => g.hasStock).length;
  }, [results, brands]);

  const brandStats = useMemo(() => {
    const map = new Map<Brand, { storeCount: number; totalQty: number; unknownCount: number }>();
    for (const b of ALL_BRANDS) map.set(b, { storeCount: 0, totalQty: 0, unknownCount: 0 });
    if (results) {
      for (const r of results) {
        const groups = groupByStore(r.stores);
        const storeCount = groups.filter((g) => g.hasStock).length;
        const unknownCount = groups.filter((g) => !g.hasStock && g.stockUnknown).length;
        const totalQty = r.stores.filter((s) => s.inStock).reduce((sum, s) => sum + (s.qty ?? 0), 0);
        map.set(r.brand, { storeCount, totalQty, unknownCount });
      }
    }
    return map;
  }, [results]);

  const errors = useMemo(() => (results ?? []).filter((r) => !r.ok), [results]);
  const staleBrands = useMemo(() => (results ?? []).filter((r) => r.ok && r.stale), [results]);
  const regionLabel = REGIONS.find((r) => r.slug === region)?.label ?? "전국";

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-gradient-to-b from-amber-500/10 to-transparent" />
      <main className="relative max-w-2xl mx-auto px-4 py-6 space-y-5">
        {/* 히어로 */}
        <div className="relative rounded-3xl bg-gradient-to-br from-amber-300 via-amber-400 to-yellow-500 p-5 shadow-lg shadow-amber-950/30">
          {results && (
            <button
              type="button"
              onClick={() => fetchStock(region)}
              disabled={loading}
              aria-label="지금 다시 조회"
              title="지금 다시 조회"
              className="absolute top-3 right-3 w-9 h-9 flex items-center justify-center rounded-full bg-white/40 hover:bg-white/60 active:scale-95 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg
                viewBox="0 0 24 24"
                className={`w-5 h-5 text-amber-900 ${loading ? "animate-spin" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>
          )}
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-2xl bg-white shadow-md overflow-hidden shrink-0 ring-4 ring-white/50">
              <ProductThumb />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-amber-900/70 uppercase tracking-wider">포켓몬카드 30주년</p>
              <h1 className="text-xl font-black text-amber-950 leading-tight">셀레브레이션 재고조회</h1>
              <p className="text-xs text-amber-900/70 mt-1">GS25·CU·세븐일레븐·이마트24 전국 재고를 한번에</p>
            </div>
          </div>
        </div>

        {/* 지역 선택 */}
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-zinc-400">지역 선택</label>
            {loading ? (
              <span className="text-xs text-amber-400 font-medium animate-pulse">조회 중...</span>
            ) : (
              lastFetchedAt && (
                <span className="text-[11px] text-zinc-500">
                  {formatAgo(lastFetchedAt, now)} 갱신
                </span>
              )
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {REGIONS.map((r) => (
              <button
                key={r.slug}
                onClick={() => fetchStock(r.slug)}
                disabled={loading}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors disabled:opacity-50 ${
                  region === r.slug && results
                    ? "bg-amber-500 text-zinc-950 border-amber-500 shadow-sm"
                    : "bg-zinc-800/60 text-zinc-300 border-zinc-800 hover:bg-amber-500/10 hover:border-amber-500/40 hover:text-amber-200"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="pt-1 border-t border-zinc-800">
            <label className="text-xs font-semibold text-zinc-400 mb-1.5 block mt-2">편의점 선택</label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_BRANDS.map((b) => {
                const active = brands.includes(b);
                return (
                  <button
                    key={b}
                    onClick={() => selectBrand(b)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      active ? "bg-zinc-800 border-zinc-600 text-zinc-100" : "bg-zinc-900 border-zinc-800 text-zinc-600"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${active ? BRAND_DOT[b] : "bg-zinc-700"}`} />
                    {BRAND_LABEL[b]}
                  </button>
                );
              })}
            </div>
          </div>

          <details className="pt-1">
            <summary className="text-xs text-zinc-500 cursor-pointer select-none">검색어 바꾸기 (기본: 30주년 셀레브레이션 자동 매칭)</summary>
            <input
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="비워두면 편의점마다 알맞은 검색어를 자동으로 써요"
              className="mt-2 w-full px-3 py-2 rounded-lg border border-zinc-700 bg-zinc-800 text-zinc-100 placeholder-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </details>
        </div>

        {/* 대시보드: 편의점별 전체 재고 */}
        {results && (
          <div>
            <p className="text-xs font-semibold text-zinc-400 px-1 mb-2">
              <span className="font-bold text-zinc-100">{regionLabel}</span> 편의점별 재고 현황
            </p>
            <div className="grid grid-cols-2 gap-2">
              {ALL_BRANDS.map((b) => {
                const stat = brandStats.get(b)!;
                const errored = errors.some((e) => e.brand === b);
                return (
                  <div key={b} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3.5">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${BRAND_DOT[b]}`} />
                      <span className="text-xs font-semibold text-zinc-400">{BRAND_LABEL[b]}</span>
                    </div>
                    {errored ? (
                      <p className="text-xs text-zinc-600 mt-2">조회 실패</p>
                    ) : stat.storeCount === 0 && stat.unknownCount > 0 ? (
                      <>
                        <p className="text-sm font-bold text-sky-400 mt-1">재고 확인 불가</p>
                        <p className="text-[11px] text-zinc-500">매장 {stat.unknownCount.toLocaleString()}곳 확인됨</p>
                      </>
                    ) : (
                      <p className="text-2xl font-black text-zinc-100 mt-1">
                        {stat.storeCount.toLocaleString()}
                        <span className="text-xs font-semibold text-zinc-500 ml-1">개 지점</span>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 결과 요약 */}
        {results && (
          <div className="flex items-center justify-between px-1">
            <p className="text-sm text-zinc-400">
              <span className="font-bold text-zinc-100">{regionLabel}</span>에 재고 있는 매장{" "}
              <span className="font-bold text-amber-400">{inStockCount}</span>곳
            </p>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={onlyInStock}
                onChange={(e) => setOnlyInStock(e.target.checked)}
                className="accent-amber-500"
              />
              재고 있는 곳만
            </label>
          </div>
        )}

        {errors.length > 0 && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
            <p className="text-xs text-rose-300">
              일부 편의점 조회 실패: {errors.map((e) => `${BRAND_LABEL[e.brand]}(${e.error})`).join(", ")}
            </p>
          </div>
        )}

        {staleBrands.length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2.5">
            <p className="text-xs text-amber-300">
              {staleBrands.map((e) => BRAND_LABEL[e.brand]).join(", ")}는 지금 업스트림 제한으로 최근 캐시된 결과를
              보여주고 있어요.
            </p>
          </div>
        )}

        {brands.includes("gs25") && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2.5">
            <p className="text-xs text-rose-300">
              GS25는 지금 쓰는 데이터 소스가 불안정해서 재고 수치가 실제와 다를 수 있어요. 꼭 방문 전에 매장에
              직접 확인해 주세요.
            </p>
          </div>
        )}

        {results && groups.length === 0 && !loading && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center text-zinc-500 text-sm">
            {onlyInStock ? "해당 조건에 재고 있는 매장이 없어요." : "해당 조건에 매장이 없어요."}
          </div>
        )}

        {!results && !loading && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-10 text-center text-zinc-500 text-sm">
            위에서 지역을 선택하면 재고를 바로 보여드려요.
          </div>
        )}

        {/* 매장 리스트 */}
        <div className="space-y-2">
          {groups.map((g) => {
            const isOpen = expanded.has(g.key);
            const textClamp = isOpen ? "" : "truncate";
            // 매칭된 상품 전체(품절 포함) — 펼치면 풀네임으로 다 보여준다.
            // 접혀 있을 땐 재고 있는 것과 "확인 불가"만 보여주고, 확정 품절은 숨긴다.
            const visibleItems = isOpen ? g.items : g.items.filter((i) => i.inStock || isTrulyUnknown(i));
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => toggleExpand(g.key)}
                className="w-full text-left bg-zinc-900 rounded-2xl border border-zinc-800 hover:border-zinc-700 transition-colors p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 ${BRAND_BADGE[g.brand]}`}>
                        {BRAND_LABEL[g.brand]}
                      </span>
                      <span className={`font-semibold text-zinc-100 ${textClamp}`}>{g.storeName}</span>
                      {g.hasStock && g.latestChangedAt !== null && now - g.latestChangedAt < RECENT_MS && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 animate-pulse shrink-0">
                          방금 입고
                        </span>
                      )}
                    </div>
                    <p className={`text-xs text-zinc-500 mt-1 ${textClamp}`}>{g.address}</p>
                  </div>
                  <div className="text-right shrink-0">
                    {g.distanceM !== null && (
                      <p className="text-xs text-zinc-500">
                        {g.distanceM >= 1000 ? `${(g.distanceM / 1000).toFixed(1)}km` : `${g.distanceM}m`}
                      </p>
                    )}
                    <span
                      className={`mt-1 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                        g.hasStock
                          ? "bg-amber-500/15 text-amber-300"
                          : g.stockUnknown
                            ? "bg-sky-500/15 text-sky-300"
                            : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {g.hasStock ? "재고 있음" : g.stockUnknown ? "재고 확인 불가" : "품절"}
                    </span>
                    {g.latestChangedAt !== null && (
                      <p className="text-[10px] text-zinc-600 mt-1">{formatAgo(g.latestChangedAt, now)} 변경</p>
                    )}
                  </div>
                </div>
                {visibleItems.length > 0 && (
                  <ul className="mt-2 pt-2 border-t border-zinc-800 space-y-1">
                    {visibleItems.map((i, idx) => {
                      const unknown = isTrulyUnknown(i);
                      const lowConfidence = i.stockKnown === false && !unknown;
                      return (
                        <li key={idx} className="flex items-start justify-between text-xs gap-2">
                          <span
                            className={`text-zinc-400 ${isOpen ? "break-words" : "truncate"} ${
                              i.inStock || unknown ? "" : "text-zinc-600"
                            }`}
                          >
                            {i.productName}
                          </span>
                          <span
                            className={`font-semibold shrink-0 text-right ${
                              unknown ? "text-sky-400" : i.inStock ? "text-amber-400" : "text-zinc-600"
                            }`}
                          >
                            {unknown ? (
                              "확인 불가"
                            ) : i.inStock ? (
                              i.qty !== null ? (
                                `${i.qty}개`
                              ) : (
                                <>
                                  재고 있음
                                  <br />
                                  <span className="text-[10px] text-zinc-500 font-normal">(수량 미공개)</span>
                                </>
                              )
                            ) : (
                              "품절"
                            )}
                            {lowConfidence && (
                              <>
                                <br />
                                <span className="text-[10px] text-rose-400/80 font-normal">(부정확할 수 있음)</span>
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <p className="text-[10px] text-zinc-600 mt-2">{isOpen ? "탭하여 접기" : "탭하여 전체 상품명 보기"}</p>
              </button>
            );
          })}
        </div>

        <p className="text-center text-[11px] text-zinc-600 pt-2">
          편의점 공식 앱의 재고 정보를 그대로 가져와요. 실제 매장 재고와 차이가 있을 수 있어요.
        </p>
      </main>
    </div>
  );
}
