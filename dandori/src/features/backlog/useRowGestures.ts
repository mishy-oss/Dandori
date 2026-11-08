import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 8
const SWIPE_START_PX = 10
const SWIPE_TRIGGER_PX = 80
const MAX_SWIPE_PX = 120

// 行の左スワイプまたは長押しで onTrigger を呼ぶ。縦スクロールはブラウザに任せる(touch-action: pan-y)
export function useRowGestures(onTrigger: () => void) {
  const triggerRef = useRef(onTrigger)
  useEffect(/* 長押し・スワイプ時に最新の呼び出し先を実行できるよう、コールバックのrefを更新する。 */ () => {
    triggerRef.current = onTrigger
  })

  const [dx, setDx] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const gestured = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  useEffect(/* 画面から外れるときに、操作中のジェスチャーのタイマーとイベント監視を解除する処理を登録する。 */ () => /* 画面から外れるときに、操作中のジェスチャーのイベント監視を解除する。 */ () => teardown.current?.(), [])

  /** 左スワイプ・長押し判定の開始位置を記録し、終了・移動・取消のイベント監視を登録する。 */
  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (teardown.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as HTMLElement).closest('[data-no-drag]')) return
    gestured.current = false

    const { pointerId, clientX: startX, clientY: startY } = e
    let mode: 'pending' | 'swipe' = 'pending'
    let lastDx = 0

    /** 長押しタイマーとポインター監視を解除し、次の操作を始められる状態に戻す。 */
    function finish() {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      teardown.current = null
    }
    /** 横方向への移動が縦移動より大きい場合に左スワイプと判定し、行の表示位置を更新する。 */
    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const mx = ev.clientX - startX
      const my = ev.clientY - startY
      if (mode === 'pending') {
        if (Math.abs(mx) <= MOVE_TOLERANCE_PX && Math.abs(my) <= MOVE_TOLERANCE_PX) return
        clearTimeout(timer)
        if (mx < -SWIPE_START_PX && Math.abs(mx) > Math.abs(my) * 1.5) {
          mode = 'swipe'
          gestured.current = true
          setSwiping(true)
        } else {
          finish()
          return
        }
      }
      lastDx = Math.max(-MAX_SWIPE_PX, Math.min(0, mx))
      setDx(lastDx)
    }
    /** 指を離した位置でスワイプ成立を判定し、表示を元へ戻して成立時のみ移動操作を呼び出す。 */
    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const triggered = mode === 'swipe' && lastDx <= -SWIPE_TRIGGER_PX
      finish()
      setSwiping(false)
      setDx(0)
      if (triggered) triggerRef.current()
    }
    /** 対象ポインターの操作が取り消されたらイベント監視を解除し、行の位置とスワイプ状態を元に戻す。 */
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      finish()
      setSwiping(false)
      setDx(0)
    }

    const timer = window.setTimeout(/* 移動せず長押し時間を満たした場合に、通常タップを抑止して移動先選択を開く。 */ () => {
      if (mode !== 'pending') return
      gestured.current = true
      finish()
      triggerRef.current()
    }, LONG_PRESS_MS)

    teardown.current = finish
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
  }, [])

  /** 直前の操作がドラッグやスワイプだったかを返し、操作直後の誤った編集画面の表示を防ぐ。 */
  const shouldSuppressClick = useCallback(() => gestured.current, [])

  return { dx, swiping, onPointerDown, shouldSuppressClick }
}
