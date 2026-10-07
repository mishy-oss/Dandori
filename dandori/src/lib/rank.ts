import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

// 並べ替え時に1件だけ更新で済む文字列ランク。prev/next は隣接する要素のランク(端は null)
export function rankBetween(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next)
}

export function rankAfter(last: string | null): string {
  return generateKeyBetween(last, null)
}

// ランクが衝突したときに列全体を振り直すための等間隔ランク
export function ranksForCount(count: number): string[] {
  return generateNKeysBetween(null, null, count)
}

export function compareRank(a: { rank: string }, b: { rank: string }): number {
  return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0
}
