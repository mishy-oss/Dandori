import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { PX_PER_MIN, clampMove, clampResize, yToMin, type Range } from './timelineLogic'

const LONG_PRESS_MS = 350
const MOVE_TOLERANCE_PX = 8
const RESIZE_TAP_TOLERANCE_PX = 3
const AUTOSCROLL_ZONE_PX = 72
const AUTOSCROLL_STEP_PX = 10

export type TimelineDrag =
  | { kind: 'move'; id: string; startMin: number }
  | { kind: 'resize'; id: string; durationMin: number }
  | { kind: 'tray'; id: string; x: number; y: number; startMin: number | null }

export interface TimedBlock {
  startMin: number
  durationMin: number
}

interface Options {
  rootRef: RefObject<HTMLElement | null>
  gridRef: RefObject<HTMLElement | null>
  scrollerRef: RefObject<HTMLElement | null>
  range: Range
  getBlock: (id: string) => TimedBlock | undefined
  getTrayDuration: (id: string) => number
  onMove: (id: string, startMin: number) => void
  onResize: (id: string, durationMin: number) => void
  onPlace: (id: string, startMin: number) => void
}

interface Session {
  kind: 'move' | 'resize' | 'tray'
  id: string
  pointerId: number
  startX: number
  startY: number
  x: number
  y: number
  active: boolean
  moved: boolean
  scrollTop0: number
  base: TimedBlock | null
  timer: number | null
  raf: number | null
}

// ブロックの長押しドラッグ(15分スナップ)、下端ドラッグでの所要時間変更、未配置リストからのドラッグ配置。
// ブロック本体は縦スクロールをブラウザに任せ(touch-action: pan-y)、長押し成立後だけ touchmove を止める。
// 下端ハンドルは touch-action: none で、掴んだらすぐ操作できる
export function useTimelineGestures(options: Options) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  const [drag, setDrag] = useState<TimelineDrag | null>(null)
  const dragRef = useRef<TimelineDrag | null>(null)
  const session = useRef<Session | null>(null)
  const blockScroll = useRef(false)
  const gestured = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  useEffect(() => {
    const root = options.rootRef.current
    if (!root) return
    const onTouchMove = (e: TouchEvent) => {
      if (blockScroll.current && e.cancelable) e.preventDefault()
    }
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    return () => root.removeEventListener('touchmove', onTouchMove)
    // rootRef は安定した ref なので初回のみ登録する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => teardown.current?.(), [])

  const publish = useCallback((next: TimelineDrag | null) => {
    const prev = dragRef.current
    const same =
      prev !== null &&
      next !== null &&
      prev.kind === next.kind &&
      prev.id === next.id &&
      JSON.stringify(prev) === JSON.stringify(next)
    if (same) return
    dragRef.current = next
    setDrag(next)
  }, [])

  const compute = useCallback((s: Session): TimelineDrag | null => {
    const { range, gridRef, scrollerRef, getTrayDuration } = optionsRef.current
    const scrolled = (scrollerRef.current?.scrollTop ?? 0) - s.scrollTop0
    const deltaMin = (s.y - s.startY + scrolled) / PX_PER_MIN

    if (s.kind === 'move' && s.base) {
      return { kind: 'move', id: s.id, startMin: clampMove(s.base.startMin + deltaMin, s.base.durationMin, range) }
    }
    if (s.kind === 'resize' && s.base) {
      return {
        kind: 'resize',
        id: s.id,
        durationMin: clampResize(s.base.durationMin + deltaMin, s.base.startMin, range),
      }
    }
    const grid = gridRef.current?.getBoundingClientRect()
    const scroller = scrollerRef.current?.getBoundingClientRect()
    let startMin: number | null = null
    if (
      grid &&
      scroller &&
      s.x >= scroller.left &&
      s.x <= scroller.right &&
      s.y >= scroller.top &&
      s.y <= scroller.bottom
    ) {
      startMin = clampMove(yToMin(s.y - grid.top, range), getTrayDuration(s.id), range)
    }
    return { kind: 'tray', id: s.id, x: s.x, y: s.y, startMin }
  }, [])

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (session.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('[data-no-drag]')) return

      const resizeEl = target.closest<HTMLElement>('[data-resize-id]')
      const blockEl = target.closest<HTMLElement>('[data-block-id]')
      const trayEl = target.closest<HTMLElement>('[data-tray-id]')
      const kind = resizeEl ? 'resize' : blockEl ? 'move' : trayEl ? 'tray' : null
      const id = resizeEl?.dataset.resizeId ?? blockEl?.dataset.blockId ?? trayEl?.dataset.trayId
      if (!kind || !id) return

      const base = kind === 'tray' ? null : (optionsRef.current.getBlock(id) ?? null)
      if (kind !== 'tray' && !base) return

      const s: Session = {
        kind,
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        active: false,
        moved: false,
        scrollTop0: optionsRef.current.scrollerRef.current?.scrollTop ?? 0,
        base,
        timer: null,
        raf: null,
      }
      session.current = s
      gestured.current = false

      function finish() {
        if (s.timer !== null) clearTimeout(s.timer)
        if (s.raf !== null) cancelAnimationFrame(s.raf)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        blockScroll.current = false
        session.current = null
        teardown.current = null
      }

      function tick() {
        if (session.current !== s || !s.active) return
        const scroller = optionsRef.current.scrollerRef.current
        if (scroller) {
          const r = scroller.getBoundingClientRect()
          if (s.y < r.top + AUTOSCROLL_ZONE_PX) scroller.scrollTop -= AUTOSCROLL_STEP_PX
          else if (s.y > r.bottom - AUTOSCROLL_ZONE_PX) scroller.scrollTop += AUTOSCROLL_STEP_PX
        }
        publish(compute(s))
        s.raf = requestAnimationFrame(tick)
      }

      function activate() {
        s.timer = null
        if (session.current !== s || s.active) return
        s.active = true
        // リサイズは動かさずに離した場合タップ扱い(ブロックを開く)にするため、移動が確認できるまで gestured にしない
        if (s.kind !== 'resize') gestured.current = true
        blockScroll.current = true
        s.scrollTop0 = optionsRef.current.scrollerRef.current?.scrollTop ?? 0
        s.startY = s.y
        publish(compute(s))
        s.raf = requestAnimationFrame(tick)
      }

      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        s.x = ev.clientX
        s.y = ev.clientY
        const dist = Math.hypot(s.x - s.startX, s.y - s.startY)
        if (!s.active) {
          if (dist > MOVE_TOLERANCE_PX) {
            // 長押し前の移動はスクロール操作として扱い、ジェスチャーを中止する
            finish()
          }
          return
        }
        if (s.kind === 'resize' && dist > RESIZE_TAP_TOLERANCE_PX) {
          s.moved = true
          gestured.current = true
        }
        publish(compute(s))
      }

      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        const wasActive = s.active
        const result = wasActive && (s.kind !== 'resize' || s.moved) ? compute(s) : null
        finish()
        publish(null)
        if (wasActive) setTimeout(() => (gestured.current = false), 0)
        if (!result) return
        const o = optionsRef.current
        if (result.kind === 'move') o.onMove(result.id, result.startMin)
        else if (result.kind === 'resize') o.onResize(result.id, result.durationMin)
        else if (result.startMin !== null) o.onPlace(result.id, result.startMin)
      }

      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        finish()
        publish(null)
      }

      teardown.current = finish
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)

      if (kind === 'resize') activate()
      else s.timer = window.setTimeout(activate, LONG_PRESS_MS)
    },
    [compute, publish],
  )

  const shouldSuppressClick = useCallback(() => gestured.current, [])

  return { drag, onPointerDown, shouldSuppressClick }
}
