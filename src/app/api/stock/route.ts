import { NextRequest, NextResponse } from "next/server";
import * as gs25 from "@/lib/gs25";
import * as cu from "@/lib/cu";
import * as seveneleven from "@/lib/seveneleven";
import * as emart24 from "@/lib/emart24";
import { getRegion } from "@/lib/regions";
import { BRAND_KEYWORDS } from "@/lib/constants";
import { withChangeTimestamps } from "@/lib/history";
import type { Brand, BrandResult, StoreStock } from "@/lib/types";

export const runtime = "nodejs";

interface Task {
  brand: Brand;
  run: () => Promise<{ stores: StoreStock[]; stale?: boolean }>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const regionSlug = searchParams.get("region") ?? "all";
  // 검색어를 직접 입력하면 그 키워드를 4곳 전부에 그대로 쓰고, 비워두면(기본값) 편의점마다
  // 실제 재고가 정확히 잡히는 키워드를 따로 써서 찾는다 (BRAND_KEYWORDS 참고).
  const customKeyword = searchParams.get("keyword")?.trim();
  const region = getRegion(regionSlug);
  const keywordFor = (brand: Brand) => customKeyword || BRAND_KEYWORDS[brand];

  const tasks: Task[] = [
    { brand: "gs25", run: async () => ({ stores: await gs25.findNearbyStock(keywordFor("gs25"), region) }) },
    { brand: "cu", run: () => cu.findNearbyStock(keywordFor("cu"), region) },
    { brand: "seveneleven", run: () => seveneleven.findNearbyStock(keywordFor("seveneleven"), region) },
    { brand: "emart24", run: () => emart24.findNearbyStock(keywordFor("emart24"), region) },
  ];

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));

  const results: BrandResult[] = await Promise.all(
    settled.map(async (r, i) => {
      const brand = tasks[i].brand;
      if (r.status === "fulfilled") {
        const stores = await withChangeTimestamps(r.value.stores);
        return { brand, ok: true, stores, stale: r.value.stale };
      }
      return { brand, ok: false, error: r.reason?.message ?? String(r.reason), stores: [] };
    })
  );

  return NextResponse.json({ keyword: customKeyword || null, region: region.slug, results });
}
