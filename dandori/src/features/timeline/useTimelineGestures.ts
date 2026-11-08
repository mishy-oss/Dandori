import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { PX_PER_MIN, clampMove, clampResize, clampResizeTop, yToMin, type Range } from './timelineLogic'

const LONG_PRESS_MS = 350
const MOVE_TOLERANCE_PX = 8
const RESIZE_TAP_TOLERANCE_PX = 3
const AUTOSCROLL_ZONE_PX = 72
const AUTOSCROLL_STEP_PX = 10

export type TimelineDrag =
  | { kind: 'move'; id: string; startMin: number }
  | { kind: 'resize'; id: string; durationMin: number }
  | { kind: 'resize-top'; id: string; startMin: number; durationMin: number }
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
  onResizeTop: (id: string, startMin: number, durationMin: number) => void
  onPlace: (id: string, startMin: number) => void
}

interface Session {
  kind: 'move' | 'resize' | 'resize-top' | 'tray'
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

// ブロックの長押しドラッグ(15分スナップ)、上端/下端ドラッグでの所要時間変更、未配置リストからのドラッグ配置。
// ブロック本体は縦スクロールをブラウザに任せ(touch-action: pan-y)、長押し成立後だけ touchmove を止める。
// 上端・下端ハンドルは touch-action: none で、掴んだらすぐ操作できる
export function useTimelineGestures(options: Options) {
  const optionsRef = useRef(options)
  useEffect(/* イベント処理から最新のオプションを参照できるよう、描画ごとにrefの内容を更新する。 */ () => {
    optionsRef.current = options
  })

  const [drag, setDrag] = useState<TimelineDrag | null>(null)
  const dragRef = useRef<TimelineDrag | null>(null)
  const session = useRef<Session | null>(null)
  const blockScroll = useRef(false)
  const gestured = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  useEffect(/* 操作領域にタッチ移動の監視を登録し、ドラッグ中だけ標準スクロールを止める。画面から外れるときは監視を解除する。 */ () => {
    const root = options.rootRef.current
    if (!root) return
    /** ドラッグ中だけタッチによる標準スクロールを抑止し、予定やカードの操作と競合しないようにする。 */
    const onTouchMove = (e: TouchEvent) => {
      if (blockScroll.current && e.cancelable) e.preventDefault()
    }
    root.addEventListener('touchmove', onTouchMove, { passive: false })
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => root.removeEventListener('touchmove', onTouchMove)
    // rootRef は安定した ref なので初回のみ登録する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(/* 画面から外れるときに、操作中のジェスチャーのタイマーとイベント監視を解除する処理を登録する。 */ () => /* 画面から外れるときに、操作中のジェスチャーのイベント監視を解除する。 */ () => teardown.current?.(), [])

  /** 直前と同じドラッグ内容なら更新を省き、変化したプレビューだけをrefとReactの状態へ反映する。 */
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

  /** ポインター移動量とスクロール差から、移動・リサイズ・新規配置のプレビュー時刻を計算する。 */
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
    if (s.kind === 'resize-top' && s.base) {
      return { kind: 'resize-top', id: s.id, ...clampResizeTop(s.base.startMin + deltaMin, s.base, range) }
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

  /** 操作対象と開始座標を記録し、長押しまたはリサイズ用のイベント監視を開始する。 */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (session.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('[data-no-drag]')) return

      const resizeEl = target.closest<HTMLElement>('[data-resize-id]')
      const resizeTopEl = target.closest<HTMLElement>('[data-resize-top-id]')
      const blockEl = target.closest<HTMLElement>('[data-block-id]')
      const trayEl = target.closest<HTMLElement>('[data-tray-id]')
      const kind = resizeEl
        ? 'resize'
        : resizeTopEl
          ? 'resize-top'
          : blockEl
            ? 'move'
            : trayEl
              ? 'tray'
              : null
      const id =
        resizeEl?.dataset.resizeId ??
        resizeTopEl?.dataset.resizeTopId ??
        blockEl?.dataset.blockId ??
        trayEl?.dataset.trayId
      if (!kind || !id) return
      const isHandle = kind === 'resize' || kind === 'resize-top'

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

      /** 操作用タイマー・描画予約・イベント監視を解除し、通常のスクロールへ戻す。 */
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

      /** ドラッグ中に上下端で自動スクロールし、変化した位置に合わせて時刻のプレビューを再計算する。 */
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

      /** 操作をドラッグ中へ切り替えてスクロールを抑止し、プレビューと自動スクロールの更新を開始する。 */
      function activate() {
        s.timer = null
        if (session.current !== s || s.active) return
        s.active = true
        // ハンドルは動かさずに離した場合タップ扱い(ブロックを開く)にするため、移動が確認できるまで gestured にしない
        if (!isHandle) gestured.current = true
        blockScroll.current = true
        s.scrollTop0 = optionsRef.current.scrollerRef.current?.scrollTop ?? 0
        s.startY = s.y
        publish(compute(s))
        s.raf = requestAnimationFrame(tick)
      }

      /** 長押し前の大きな移動なら操作を中止し、ドラッグ開始後は座標に応じて時刻や所要時間のプレビューを更新する。 */
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
        if (isHandle && dist > RESIZE_TAP_TOLERANCE_PX) {
          s.moved = true
          gestured.current = true
        }
        publish(compute(s))
      }

      /** ドラッグ結果を確定してプレビューを消し、操作種別に応じて移動・上下端リサイズ・新規配置の保存を呼ぶ。 */
      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        const wasActive = s.active
        const result = wasActive && (!isHandle || s.moved) ? compute(s) : null
        finish()
        publish(null)
        if (wasActive) setTimeout(/* 直後のクリック判定が済んだ後でジェスチャーフラグを解除し、次の通常タップを受け付ける。 */ () => (gestured.current = false), 0)
        if (!result) return
        const o = optionsRef.current
        if (result.kind === 'move') o.onMove(result.id, result.startMin)
        else if (result.kind === 'resize') o.onResize(result.id, result.durationMin)
        else if (result.kind === 'resize-top') o.onResizeTop(result.id, result.startMin, result.durationMin)
        else if (result.startMin !== null) o.onPlace(result.id, result.startMin)
      }

      /** 対象ポインターの操作取消時に監視とタイマーを止め、時刻変更を保存せずプレビューを消す。 */
      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        finish()
        publish(null)
      }

      teardown.current = finish
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)

      if (isHandle) activate()
      else s.timer = window.setTimeout(activate, LONG_PRESS_MS)
    },
    [compute, publish],
  )

  /** 直前の操作がドラッグやスワイプだったかを返し、操作直後の誤った編集画面の表示を防ぐ。 */
  const shouldSuppressClick = useCallback(() => gestured.current, [])

  return { drag, onPointerDown, shouldSuppressClick }
}
