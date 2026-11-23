export const SWIPE_THRESHOLD_PX = 80

// 移動後の列で位置を数えるため、midYs に移動中のカードは含めない。
export function computeDropIndex(midYs: number[], pointerY: number): number {
  let index = 0
  for (const y of midYs) {
    if (y < pointerY) index++
  }
  return index
}

// 左スワイプで次のステータス、右スワイプで前のステータス。端では null
export function swipeTargetIndex(
  activeIndex: number,
  dx: number,
  columnCount: number,
  threshold = SWIPE_THRESHOLD_PX,
): number | null {
  if (Math.abs(dx) < threshold) return null
  const target = activeIndex + (dx < 0 ? 1 : -1)
  return target >= 0 && target < columnCount ? target : null
}

export function wipStatus(
  count: number,
  limit: number | undefined,
): { over: boolean; label: string | null } {
  if (limit === undefined) return { over: false, label: null }
  return { over: count > limit, label: `${count}/${limit}` }
}
