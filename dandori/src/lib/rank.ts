import { generateKeyBetween } from 'fractional-indexing'

// 並べ替え時に1件だけ更新で済む文字列ランク。prev/next は隣接する要素のランク(端は null)
export function rankBetween(prev: string | null, next: string | null): string {
  return generateKeyBetween(prev, next)
}

export function rankAfter(last: string | null): string {
  return generateKeyBetween(last, null)
}
