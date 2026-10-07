// 매장+상품 조합의 재고 상태(qty/inStock)가 마지막으로 바뀐 시각을 기억해뒀다가,
// 조회할 때마다 비교해서 "n분 전에 바뀜"을 붙여준다. 서버 프로세스가 떠 있는 동안은
// 메모리 캐시를 쓰고, data/stock-history.json에도 남겨서 재시작해도 최근 이력을 유지한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { StoreStock } from "./types";

const HISTORY_FILE = "data/stock-history.json";

interface HistoryEntry {
  qty: number | null;
  inStock: boolean;
  changedAt: number;
}

type HistoryMap = Record<string, HistoryEntry>;

let cache: HistoryMap | null = null;
let loading: Promise<HistoryMap> | null = null;

async function loadHistory(): Promise<HistoryMap> {
  if (cache) return cache;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await readFile(HISTORY_FILE, "utf8");
        cache = JSON.parse(raw) as HistoryMap;
      } catch {
        cache = {};
      }
      return cache;
    })();
  }
  return loading;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(map: HistoryMap) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await mkdir("data", { recursive: true });
      await writeFile(HISTORY_FILE, JSON.stringify(map), "utf8");
    } catch {
      // 쓰기 실패해도 조회 자체는 계속 진행 (서버리스 환경 등)
    }
  }, 500);
}

const keyOf = (s: StoreStock) => `${s.brand}|${s.storeName}|${s.address}|${s.productName}`;

// 한 번 조회로 쓸 수 있을 만큼만 바뀌는 값을 비교하므로, qty가 모두 null인(재고 확인 불가)
// 상태끼리는 변화로 치지 않는다 — 데이터 소스 자체의 노이즈로 "방금 바뀜"이 계속 뜨는 걸 막는다.
function stateEqual(prev: HistoryEntry, cur: StoreStock): boolean {
  return prev.qty === cur.qty && prev.inStock === cur.inStock;
}

export async function withChangeTimestamps(stores: StoreStock[]): Promise<StoreStock[]> {
  const map = await loadHistory();
  const now = Date.now();
  let dirty = false;
  const out = stores.map((s): StoreStock => {
    const key = keyOf(s);
    const prev = map[key];
    let changedAt: number;
    if (!prev || !stateEqual(prev, s)) {
      changedAt = now;
      map[key] = { qty: s.qty, inStock: s.inStock, changedAt: now };
      dirty = true;
    } else {
      changedAt = prev.changedAt;
    }
    return { ...s, changedAt };
  });
  if (dirty) scheduleSave(map);
  return out;
}
