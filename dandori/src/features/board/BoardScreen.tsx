import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue } from '../../db/types'
import { columnIssues } from '../../lib/issueOrder'
import { selectActiveSprint, selectCurrentProject, useDataStore } from '../../store/data'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { SprintOverdueBanner } from '../sprint/SprintOverdueBanner'
import { BoardCard } from './BoardCard'
import { wipStatus } from './boardLogic'
import { useBoardGestures } from './useBoardGestures'

// アクティブスプリントのIssueだけを表示するカンバン
export function BoardScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore(/* 現在のプロジェクトに対応するワークフローをストアから取得する。 */ (s) => (project ? s.workflows[project.workflowId] : undefined))
  const allIssues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  const sprint = useDataStore(selectActiveSprint)
  const ready = useDataStore(/* ストアから初期化の完了状態を取得する。 */ (s) => s.ready)
  const moveIssue = useDataStore(/* ストアからmoveIssue（保存・状態変更の操作）を取得する。 */ (s) => s.moveIssue)
  const toggleIssueDone = useDataStore(/* ストアからtoggleIssueDone（保存・状態変更の操作）を取得する。 */ (s) => s.toggleIssueDone)

  /** Issueを関連データから計算し、依存する値が変わるまで結果を再利用する。 */
  const issues = useMemo(
    () => (sprint ? allIssues.filter(/* 指定スプリントまたはバックログと一致という条件を満たす要素だけを残す。 */ (i) => i.sprintId === sprint.id) : []),
    [allIssues, sprint],
  )
  const [columnIndex, setColumnIndex] = useState(0)
  const [editing, setEditing] = useState<Issue | 'new' | null>(null)
  const [pulseId, setPulseId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  /** ステータスを関連データから計算し、依存する値が変わるまで結果を再利用する。 */
  const statuses = useMemo(() => workflow?.statuses ?? [], [workflow])
  /** 完了カテゴリのステータスIDを集合にし、各Issueの完了判定に使う。 */
  const doneIds = useMemo(
    () => new Set(statuses.filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (s) => s.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (s) => s.id)),
    [statuses],
  )
  const activeIndex = Math.min(columnIndex, Math.max(statuses.length - 1, 0))
  const active = statuses[activeIndex]

  useEffect(/* 操作対象の強調表示を400ミリ秒後に解除し、対象が変わったら以前の解除予約を取り消す。 */ () => {
    if (!pulseId) return
    const t = setTimeout(/* 操作対象の一時強調を解除する。 */ () => setPulseId(null), 400)
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => clearTimeout(t)
  }, [pulseId])

  // 完了にすると Done 系の列の末尾へ、戻すと To Do 系の列へ移る。移動先のタブをバウンスさせて知らせる
  async function toggleDone(issueId: string) {
    try {
      setError(null)
      await toggleIssueDone(issueId)
      const moved = useDataStore.getState().issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (i) => i.id === issueId)
      if (moved) setPulseId(`tab:${moved.statusId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  /** 指定列の指定位置へIssueを保存し、操作対象を強調する。保存に失敗した場合はエラーを表示する。 */
  async function move(issueId: string, statusIdx: number, index: number) {
    const status = statuses[statusIdx]
    if (!status || !sprint) return
    setPulseId(issueId)
    try {
      setError(null)
      await moveIssue(issueId, status.id, index, sprint.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const { drag, dropIndex, swipe, onPointerDown, shouldSuppressClick } = useBoardGestures({
    listRef,
    activeIndex,
    columnCount: statuses.length,
    onSwitchColumn: setColumnIndex,
    /** アニメーション後の最新のIssue一覧から移動先列の末尾を求め、スワイプしたIssueをそこへ移す。 */
    onSwipeMove: (id, target) => {
      // 実行時点の最新の並びの末尾へ入れる(アニメーション待ちの間に状態が変わりうるため)
      const latest = useDataStore.getState().issues
      void move(id, target, columnIssues(latest, statuses[target].id, sprint?.id).length)
    },
    /** ドロップ先のステータス列と挿入位置を受け取り、Issueの移動を保存する。 */
    onDrop: (id, col, index) => void move(id, col, index),
  })

  if (!ready || !project || !active) return null

  if (!sprint) {
    return (
      <section className="flex flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Board</h1>
        <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
          アクティブなスプリントがありません。Backlog でスプリントにIssueを追加して開始してください
        </p>
      </section>
    )
  }

  const column = columnIssues(issues, active.id)
  const wip = wipStatus(column.length, active.wipLimit)
  const draggedIssue = drag ? issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (i) => i.id === drag.issueId) : undefined

  // ドラッグ中のカードは列が切り替わっても同じ <ul> に残し、タッチ操作の対象要素を維持する
  const base = draggedIssue && !column.includes(draggedIssue) ? [...column, draggedIssue] : column
  const rows: Array<{ kind: 'card'; issue: Issue } | { kind: 'placeholder' }> = []
  let seen = 0
  let placed = false
  for (const issue of base) {
    if (drag && issue.id === drag.issueId) {
      rows.push({ kind: 'card', issue })
      continue
    }
    if (drag && !placed && seen === dropIndex) {
      rows.push({ kind: 'placeholder' })
      placed = true
    }
    rows.push({ kind: 'card', issue })
    seen++
  }
  if (drag && !placed) rows.push({ kind: 'placeholder' })

  return (
    <section className="flex min-h-full flex-col gap-3 p-4">
      <div>
        <h1 className="text-2xl font-bold">Board</h1>
        <p className="text-sm text-muted">
          {sprint.name}({sprint.startDate} 〜 {sprint.endDate})
        </p>
      </div>

      <SprintOverdueBanner />

      <div role="tablist" aria-label="ステータス" className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {statuses.map(/* 各ステータスの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (s, i) => {
          const count = columnIssues(issues, s.id).length
          const over = wipStatus(count, s.wipLimit).over
          return (
            <button
              key={s.id}
              role="tab"
              aria-selected={i === activeIndex}
              onClick={/* 操作内容に合わせて選択中のステータス列を更新する。 */ () => setColumnIndex(i)}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm ${
                i === activeIndex ? 'border-accent bg-accent text-accent-text' : 'border-border bg-surface'
              } ${pulseId === `tab:${s.id}` ? 'animate-pop' : ''}`}
            >
              {s.name}
              <span
                className={`rounded-full px-2 text-xs ${
                  over ? 'bg-amber-500 text-black' : 'bg-black/10 dark:bg-white/10'
                }`}
              >
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {wip.over && (
        <p role="status" className="rounded-lg border border-amber-500 bg-amber-500/10 p-3 text-sm">
          ⚠ WIP上限({active.wipLimit}件)を超えています({column.length}件)。ブロックはしません
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-500">
          {error}
        </p>
      )}

      <ul
        ref={listRef}
        aria-label={active.name}
        onPointerDown={onPointerDown}
        onContextMenu={/* 長押しや右クリックによる標準メニューを抑止し、ジェスチャー操作を続けられるようにする。 */ (e) => e.preventDefault()}
        className="flex flex-col gap-2 pb-24"
      >
        {rows.length === 0 && (
          <li className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
            この列にIssueはありません
          </li>
        )}
        {rows.map(/* 各カードと挿入位置の表示要素を作り、対応する選択・編集操作を結び付ける。 */ (row) => {
          if (row.kind === 'placeholder') {
            return (
              <li
                key="placeholder"
                aria-hidden
                className="rounded-xl border-2 border-dashed border-accent/60 bg-accent/10"
                style={{ height: drag?.height }}
              />
            )
          }
          const issue = row.issue
          const isDragged = drag?.issueId === issue.id
          const swipeHere = swipe?.issueId === issue.id ? swipe : null
          return (
            <li key={issue.id}>
              <BoardCard
                issue={issue}
                done={doneIds.has(issue.statusId)}
                pulse={pulseId === issue.id}
                swipeDx={swipeHere?.dx}
                swipeAnimating={swipeHere ? !swipeHere.active : true}
                prevLabel={statuses[activeIndex - 1]?.name}
                nextLabel={statuses[activeIndex + 1]?.name}
                floating={
                  isDragged && drag
                    ? {
                        position: 'fixed',
                        left: drag.x - drag.grabX,
                        top: drag.y - drag.grabY,
                        width: drag.width,
                      }
                    : undefined
                }
                onOpen={/* 対象Issueの編集画面を開く。 */ () => {
                  if (!shouldSuppressClick()) setEditing(issue)
                }}
                onToggleDone={/* 対象Issueの完了・未完了状態を切り替える処理を呼び出す。 */ () => void toggleDone(issue.id)}
              />
            </li>
          )
        })}
      </ul>

      {drag && (
        <>
          {activeIndex > 0 && (
            <div
              aria-hidden
              className="pointer-events-none fixed left-0 top-1/2 z-40 -translate-y-1/2 rounded-r-lg bg-accent/80 px-2 py-3 text-xs font-semibold text-accent-text"
            >
              ← {statuses[activeIndex - 1].name}
            </div>
          )}
          {activeIndex < statuses.length - 1 && (
            <div
              aria-hidden
              className="pointer-events-none fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-lg bg-accent/80 px-2 py-3 text-xs font-semibold text-accent-text"
            >
              {statuses[activeIndex + 1].name} →
            </div>
          )}
        </>
      )}

      <button
        aria-label="Issueを作成"
        onClick={/* 新規Issueの作成画面を開く。 */ () => setEditing('new')}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-3xl text-accent-text shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
      >
        +
      </button>

      {editing && (
        <IssueEditor
          key={editing === 'new' ? 'new' : editing.id}
          issue={editing === 'new' ? null : editing}
          defaultStatusId={active.id}
          defaultSprintId={sprint.id}
          onClose={/* Issue編集画面を閉じる。 */ () => setEditing(null)}
        />
      )}
    </section>
  )
}
