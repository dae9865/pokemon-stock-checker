import { NextRequest } from "next/server";
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

  // 4개 편의점을 다 모을 때까지 기다리지 않고, 각 편의점이 끝나는 대로 한 줄씩(NDJSON) 바로
  // 흘려보낸다 — 제일 느린 편의점(보통 이마트24) 때문에 화면 전체가 멈춰 보이는 걸 막는다.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(
        encoder.encode(JSON.stringify({ type: "meta", keyword: customKeyword || null, region: region.slug }) + "\n")
      );
      await Promise.all(
        tasks.map(async (t) => {
          let result: BrandResult;
          try {
            const r = await t.run();
            const stores = await withChangeTimestamps(r.stores);
            result = { brand: t.brand, ok: true, stores, stale: r.stale };
          } catch (err) {
            const e = err as { message?: string } | undefined;
            result = { brand: t.brand, ok: false, error: e?.message ?? String(err), stores: [] };
          }
          controller.enqueue(encoder.encode(JSON.stringify({ type: "result", ...result }) + "\n"));
        })
      );
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
