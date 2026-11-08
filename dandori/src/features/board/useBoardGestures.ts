import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { computeDropIndex, swipeTargetIndex } from './boardLogic'

const LONG_PRESS_MS = 350
const MOVE_TOLERANCE_PX = 8
const SWIPE_START_PX = 10
const MAX_SWIPE_PX = 160
const EDGE_PX = 44
const EDGE_DWELL_MS = 600
const AUTOSCROLL_ZONE_PX = 72
const AUTOSCROLL_STEP_PX = 10
const LEAVE_MS = 160

export interface DragState {
  issueId: string
  x: number
  y: number
  grabX: number
  grabY: number
  width: number
  height: number
}

export interface SwipeState {
  issueId: string
  dx: number
  active: boolean
}

interface Options {
  listRef: RefObject<HTMLUListElement | null>
  activeIndex: number
  columnCount: number
  onSwitchColumn: (index: number) => void
  onSwipeMove: (issueId: string, targetColumnIndex: number) => void
  onDrop: (issueId: string, columnIndex: number, dropIndex: number) => void
}

interface Session {
  pointerId: number
  issueId: string
  el: HTMLElement
  startX: number
  startY: number
  x: number
  y: number
  mode: 'pending' | 'swipe' | 'drag'
  grabX: number
  grabY: number
  timer: number | null
  raf: number | null
  edgeSince: number | null
}

// カードの長押しドラッグ(並べ替え・列間移動)と左右スワイプを扱う。
// 縦スクロールはブラウザに任せ(touch-action: pan-y)、長押し成立後だけ touchmove を止める
export function useBoardGestures(options: Options) {
  const optionsRef = useRef(options)
  useEffect(/* イベント処理から最新のオプションを参照できるよう、描画ごとにrefの内容を更新する。 */ () => {
    optionsRef.current = options
  })

  const [drag, setDrag] = useState<DragState | null>(null)
  const [dropIndex, setDropIndex] = useState(0)
  const [swipe, setSwipe] = useState<SwipeState | null>(null)

  const session = useRef<Session | null>(null)
  const dropIndexRef = useRef(0)
  const blockScroll = useRef(false)
  const gestured = useRef(false)
  const teardown = useRef<(() => void) | null>(null)

  useEffect(/* 操作領域にタッチ移動の監視を登録し、ドラッグ中だけ標準スクロールを止める。画面から外れるときは監視を解除する。 */ () => {
    const list = options.listRef.current
    if (!list) return
    /** ドラッグ中だけタッチによる標準スクロールを抑止し、予定やカードの操作と競合しないようにする。 */
    const onTouchMove = (e: TouchEvent) => {
      if (blockScroll.current && e.cancelable) e.preventDefault()
    }
    list.addEventListener('touchmove', onTouchMove, { passive: false })
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => list.removeEventListener('touchmove', onTouchMove)
    // listRef は安定した ref なので初回のみ登録する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(/* 画面から外れるときに、操作中のジェスチャーのタイマーとイベント監視を解除する処理を登録する。 */ () => /* 画面から外れるときに、操作中のジェスチャーのイベント監視を解除する。 */ () => teardown.current?.(), [])

  /** 表示中のカードの中央座標を測り、ドラッグ対象を除外してドロップ先の挿入位置を計算する。 */
  const measureDropIndex = useCallback((issueId: string, y: number) => {
    const list = optionsRef.current.listRef.current
    if (!list) return 0
    const mids: number[] = []
    list.querySelectorAll<HTMLElement>('[data-card-id]').forEach(/* ドラッグ対象を除くカードの中央Y座標を測り、挿入位置の判定用に集める。 */ (el) => {
      if (el.dataset.cardId === issueId) return
      const r = el.getBoundingClientRect()
      mids.push(r.top + r.height / 2)
    })
    return computeDropIndex(mids, y)
  }, [])

  /** 操作対象と開始座標を記録し、長押しまたはリサイズ用のイベント監視を開始する。 */
  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (session.current) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-card-id]')
      if ((e.target as HTMLElement).closest('[data-no-drag]')) return
      const issueId = el?.dataset.cardId
      if (!el || !issueId) return

      const rect = el.getBoundingClientRect()
      const s: Session = {
        pointerId: e.pointerId,
        issueId,
        el,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        mode: 'pending',
        grabX: e.clientX - rect.left,
        grabY: e.clientY - rect.top,
        timer: null,
        raf: null,
        edgeSince: null,
      }
      session.current = s
      gestured.current = false

      /** 操作用タイマー・描画予約・イベント監視を解除し、スクロール制限と操作状態をリセットする。 */
      function finish(resetClickFlag = true) {
        if (s.timer !== null) clearTimeout(s.timer)
        if (s.raf !== null) cancelAnimationFrame(s.raf)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        blockScroll.current = false
        session.current = null
        teardown.current = null
        if (resetClickFlag) setTimeout(/* 直後のクリック判定が済んだ後でジェスチャーフラグを解除し、次の通常タップを受け付ける。 */ () => (gestured.current = false), 0)
      }

      /** ドラッグ中に端で自動スクロールし、左右端に一定時間とどまったら列を切り替える。挿入位置を再計算して次の描画を予約する。 */
      function tick() {
        if (session.current !== s || s.mode !== 'drag') return
        const { listRef, activeIndex, columnCount, onSwitchColumn } = optionsRef.current
        const scroller = listRef.current?.closest('main')
        if (scroller) {
          const r = scroller.getBoundingClientRect()
          if (s.y < r.top + AUTOSCROLL_ZONE_PX) scroller.scrollTop -= AUTOSCROLL_STEP_PX
          else if (s.y > r.bottom - AUTOSCROLL_ZONE_PX) scroller.scrollTop += AUTOSCROLL_STEP_PX
        }

        const dir = s.x < EDGE_PX ? -1 : s.x > window.innerWidth - EDGE_PX ? 1 : 0
        const target = activeIndex + dir
        if (dir !== 0 && target >= 0 && target < columnCount) {
          const t = performance.now()
          if (s.edgeSince === null) s.edgeSince = t
          else if (t - s.edgeSince > EDGE_DWELL_MS) {
            onSwitchColumn(target)
            s.edgeSince = t
          }
        } else {
          s.edgeSince = null
        }

        const next = measureDropIndex(s.issueId, s.y)
        if (next !== dropIndexRef.current) {
          dropIndexRef.current = next
          setDropIndex(next)
        }
        s.raf = requestAnimationFrame(tick)
      }

      /** 長押しが成立したカードをドラッグ状態へ切り替え、つかんだ位置・寸法・初期挿入位置を記録する。 */
      function startDrag() {
        s.timer = null
        if (session.current !== s || s.mode !== 'pending') return
        s.mode = 'drag'
        gestured.current = true
        blockScroll.current = true
        const r = s.el.getBoundingClientRect()
        const list = optionsRef.current.listRef.current
        const cards = list ? [...list.querySelectorAll<HTMLElement>('[data-card-id]')] : []
        const idx = cards.filter(/* 並べ替えの位置を数える対象から、ドラッグ中のカード自身を除外する。 */ (c) => c !== s.el).filter(/* ドラッグ対象より前に表示されているカードだけを数え、開始時点の挿入位置を求める。 */ (c) => c.compareDocumentPosition(s.el) & Node.DOCUMENT_POSITION_FOLLOWING).length
        dropIndexRef.current = idx
        setDropIndex(idx)
        setDrag({
          issueId: s.issueId,
          x: s.x,
          y: s.y,
          grabX: s.grabX,
          grabY: s.grabY,
          width: r.width,
          height: r.height,
        })
        s.raf = requestAnimationFrame(tick)
      }

      /** 指やマウスの移動を追跡し、縦スクロールと横スワイプを判別して、ドラッグやスワイプの表示状態を更新する。 */
      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        s.x = ev.clientX
        s.y = ev.clientY
        const dx = s.x - s.startX
        const dy = s.y - s.startY

        if (s.mode === 'pending') {
          if (Math.abs(dx) <= MOVE_TOLERANCE_PX && Math.abs(dy) <= MOVE_TOLERANCE_PX) return
          if (s.timer !== null) {
            clearTimeout(s.timer)
            s.timer = null
          }
          if (Math.abs(dx) > SWIPE_START_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
            s.mode = 'swipe'
            gestured.current = true
            blockScroll.current = true
          } else {
            // 縦方向はスクロールとして扱い、ジェスチャーは中止する
            finish()
            return
          }
        }

        if (s.mode === 'swipe') {
          const { activeIndex, columnCount } = optionsRef.current
          const blocked = (dx < 0 && activeIndex >= columnCount - 1) || (dx > 0 && activeIndex <= 0)
          const shown = Math.max(-MAX_SWIPE_PX, Math.min(MAX_SWIPE_PX, blocked ? dx * 0.2 : dx))
          setSwipe({ issueId: s.issueId, dx: shown, active: true })
        } else if (s.mode === 'drag') {
          setDrag(/* ドラッグ状態が存在する場合だけ、直前の状態を引き継いでポインター座標を更新する。 */ (d) => (d ? { ...d, x: s.x, y: s.y } : d))
        }
      }

      /** ドラッグの挿入先またはスワイプの移動先を確定する。スワイプは退出アニメーションの完了後に移動処理を呼ぶ。 */
      function onUp(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        const { activeIndex, columnCount, onSwipeMove, onDrop } = optionsRef.current
        const mode = s.mode
        const dx = s.x - s.startX
        const issueId = s.issueId
        const finalDrop = mode === 'drag' ? measureDropIndex(issueId, s.y) : 0
        finish()

        if (mode === 'drag') {
          setDrag(null)
          onDrop(issueId, activeIndex, finalDrop)
        } else if (mode === 'swipe') {
          const target = swipeTargetIndex(activeIndex, dx, columnCount)
          if (target === null) {
            setSwipe(null)
          } else {
            setSwipe({ issueId, dx: dx < 0 ? -window.innerWidth : window.innerWidth, active: false })
            setTimeout(/* スワイプの退出アニメーションが終わってから表示を消し、移動先列への保存を呼び出す。 */ () => {
              setSwipe(null)
              onSwipeMove(issueId, target)
            }, LEAVE_MS)
          }
        }
      }

      /** 操作中のポインターが取り消されたら、監視とタイマーを止めてドラッグ・スワイプ表示を消す。 */
      function onCancel(ev: PointerEvent) {
        if (ev.pointerId !== s.pointerId) return
        finish()
        setDrag(null)
        setSwipe(null)
      }

      teardown.current = /* 画面破棄時に現在のジェスチャーのタイマーとイベント監視を解除する。 */ () => finish(false)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      s.timer = window.setTimeout(startDrag, LONG_PRESS_MS)
    },
    [measureDropIndex],
  )

  /** 直前の操作がドラッグやスワイプだったかを返し、操作直後の誤った編集画面の表示を防ぐ。 */
  const shouldSuppressClick = useCallback(() => gestured.current, [])

  return { drag, dropIndex, swipe, onPointerDown, shouldSuppressClick }
}
