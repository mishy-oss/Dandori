import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const LONG_PRESS_MS = 500
const MOVE_TOLERANCE_PX = 8
const SWIPE_START_PX = 10
const SWIPE_TRIGGER_PX = 80
const MAX_SWIPE_PX = 120

// 行の左スワイプまたは長押しで onTrigger を呼ぶ。縦スクロールはブラウザに任せる(touch-action: pan-y)
export function useRowGestures(onTrigger: () => void) {
  const triggerRef = useRef(onTrigger)
  useEffect(() => {
    triggerRef.current = onTrigger
  })

  const [dx, setDx] = useState(0)
  const [swiping, setSwiping] = useState(false)
  const gestured = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  useEffect(() => () => teardown.current?.(), [])

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (teardown.current) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    gestured.current = false

    const { pointerId, clientX: startX, clientY: startY } = e
    let mode: 'pending' | 'swipe' = 'pending'
    let lastDx = 0

    function finish() {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      teardown.current = null
    }
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
    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const triggered = mode === 'swipe' && lastDx <= -SWIPE_TRIGGER_PX
      finish()
      setSwiping(false)
      setDx(0)
      if (triggered) triggerRef.current()
    }
    function onCancel(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      finish()
      setSwiping(false)
      setDx(0)
    }

    const timer = window.setTimeout(() => {
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

  const shouldSuppressClick = useCallback(() => gestured.current, [])

  return { dx, swiping, onPointerDown, shouldSuppressClick }
}
