import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue } from '../../db/types'
import { addDaysStr, todayStr } from '../../lib/date'
import { selectActiveSprint, selectCurrentProject, useDataStore } from '../../store/data'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { SprintOverdueBanner } from '../sprint/SprintOverdueBanner'
import { TimelineGrid } from './TimelineGrid'
import { UnplacedTray } from './UnplacedTray'
import { WeekStrip } from './WeekStrip'
import { PX_PER_MIN, clampMove, nowMin, visibleRange, weekDays } from './timelineLogic'
import { useNow } from './useNow'
import { useTimelineGestures } from './useTimelineGestures'

type EditorState = { issue: Issue } | { create: { startMin: number | null } } | null

/** 選択日の予定と未配置Issueを表示し、週移動・時刻指定の新規作成・ドラッグによる配置や時間変更を保存する。 */
export function TimelineScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore(/* 現在のプロジェクトに対応するワークフローをストアから取得する。 */ (s) => (project ? s.workflows[project.workflowId] : undefined))
  const sprint = useDataStore(selectActiveSprint)
  const issues = useDataStore(/* ストアからIssueを取得する。 */ (s) => s.issues)
  const settings = useDataStore(/* ストアから画面設定を取得する。 */ (s) => s.settings)
  const ready = useDataStore(/* ストアから初期化の完了状態を取得する。 */ (s) => s.ready)
  const scheduleIssue = useDataStore(/* ストアからscheduleIssue（保存・状態変更の操作）を取得する。 */ (s) => s.scheduleIssue)
  const toggleIssueDone = useDataStore(/* ストアからtoggleIssueDone（保存・状態変更の操作）を取得する。 */ (s) => s.toggleIssueDone)

  const now = useNow()
  const today = todayStr(now)
  /** 初回表示時点の選択日を計算する。 */
  const [selected, setSelected] = useState(() => todayStr())
  const [editor, setEditor] = useState<EditorState>(null)
  const [error, setError] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  /** 完了カテゴリのステータスIDを集合にし、各Issueの完了判定に使う。 */
  const doneIds = useMemo(
    () => new Set((workflow?.statuses ?? []).filter(/* 完了カテゴリという条件を満たす要素だけを残す。 */ (s) => s.category === 'done').map(/* 各要素からIDだけを取り出す。 */ (s) => s.id)),
    [workflow],
  )
  /** 選択日に配置されたIssueを関連データから計算し、依存する値が変わるまで結果を再利用する。 */
  const scheduled = useMemo(
    () => issues.filter(/* 開始時刻が設定済み・指定日と一致という条件を満たす要素だけを残す。 */ (i) => i.date === selected && i.startMin !== null),
    [issues, selected],
  )
  /** 未配置のIssueを関連データから計算し、依存する値が変わるまで結果を再利用する。 */
  const unplaced = useMemo(
    () =>
      sprint
        ? issues.filter(
            /** 未完了・指定スプリントまたはバックログと一致・開始時刻が未設定・Epic以外という条件を満たす要素だけを残す。 */
            (i) => i.sprintId === sprint.id && i.startMin === null && i.type !== 'epic' && !doneIds.has(i.statusId),
          )
        : [],
    [issues, sprint, doneIds],
  )
  /** 選択日の予定がすべて見えるよう、設定と配置時刻からタイムラインの表示範囲を計算する。 */
  const range = useMemo(
    () =>
      visibleRange(
        settings.dayStartHour,
        settings.dayEndHour,
        scheduled.map(/* 予定の重なりや表示範囲の計算に使うID・開始時刻・所要時間を取り出す。 */ (i) => ({ id: i.id, startMin: i.startMin!, durationMin: i.durationMin })),
      ),
    [settings.dayStartHour, settings.dayEndHour, scheduled],
  )
  const days = weekDays(selected, settings.weekStartsOn)
  /** 時刻が指定されている日付を集め、週表示で予定のある日に印を付けられるようにする。 */
  const marked = useMemo(
    () => new Set(issues.filter(/* 開始時刻が設定済み・日付が設定済みという条件を満たす要素だけを残す。 */ (i) => i.date !== null && i.startMin !== null).map(/* 各要素から日付だけを取り出す。 */ (i) => i.date!)),
    [issues],
  )

  /** 配置・時間変更・完了切替の保存を実行し、失敗時はタイムラインにエラーを表示する。 */
  async function run(action: () => Promise<unknown>) {
    try {
      setError(null)
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const { drag, onPointerDown, shouldSuppressClick } = useTimelineGestures({
    rootRef,
    gridRef,
    scrollerRef,
    range,
    /** 対象Issueが時刻指定済みなら、ドラッグ計算に使う開始時刻と所要時間を取り出す。 */
    getBlock: (id) => {
      const i = issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === id)
      return i && i.startMin !== null ? { startMin: i.startMin, durationMin: i.durationMin } : undefined
    },
    /** 未配置Issueの所要時間を取得し、見つからない場合は設定の既定値を返す。 */
    getTrayDuration: (id) => issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === id)?.durationMin ?? settings.defaultDuration,
    /** 予定のドラッグ後の開始時刻を、選択中の日付で保存する。 */
    onMove: (id, startMin) => void run(/* 変更した日付・開始時刻・所要時間を、対象Issueのスケジュールへ保存する。 */ () => scheduleIssue(id, { date: selected, startMin })),
    /** 下端ドラッグで変わった所要時間を、元の日付・開始時刻を維持して保存する。 */
    onResize: (id, durationMin) => {
      const i = issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === id)
      if (i) void run(/* 変更した日付・開始時刻・所要時間を、対象Issueのスケジュールへ保存する。 */ () => scheduleIssue(id, { date: i.date, startMin: i.startMin, durationMin }))
    },
    /** 上端ドラッグで変わった開始時刻と所要時間を、元の日付を維持して保存する。 */
    onResizeTop: (id, startMin, durationMin) => {
      const i = issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (x) => x.id === id)
      if (i) void run(/* 変更した日付・開始時刻・所要時間を、対象Issueのスケジュールへ保存する。 */ () => scheduleIssue(id, { date: i.date, startMin, durationMin }))
    },
    /** 未配置Issueを選択日の指定時刻へ配置して保存する。 */
    onPlace: (id, startMin) => void run(/* 変更した日付・開始時刻・所要時間を、対象Issueのスケジュールへ保存する。 */ () => scheduleIssue(id, { date: selected, startMin })),
  })

  // 日付を切り替えたとき(今日なら現在時刻の少し前、それ以外は先頭)へスクロールする
  const rangeStart = range.startMin
  useEffect(/* 日付切替後にスクロール位置を合わせる。今日なら現在時刻の少し前、他の日なら時間軸の先頭を表示する。 */ () => {
    const scroller = scrollerRef.current
    if (!scroller || !ready) return
    const target = selected === todayStr() ? Math.max(rangeStart, nowMin() - 60) : rangeStart
    scroller.scrollTop = (target - rangeStart) * PX_PER_MIN
  }, [selected, ready, rangeStart])

  if (!ready || !project) return null

  const title = format(parseISO(selected), 'M月d日', { locale: ja })
  const nowLine = selected === today ? nowMin(now) : null

  return (
    <div ref={rootRef} onPointerDown={onPointerDown} className="flex h-full min-h-0 flex-col pt-6">
      <div className="flex shrink-0 items-center gap-2 px-6 pb-2">
        <h1 className="flex-1 text-[25px] font-semibold tracking-[-0.04em]">
          {title}<span className="ml-2 font-medium text-accent">{format(parseISO(selected), 'yyyy')}</span>
        </h1>
        {selected !== today && (
          <button
            onClick={/* 操作内容に合わせて選択日を更新する。 */ () => setSelected(todayStr())}
            className="min-h-11 rounded-full px-3 text-xs font-medium text-accent"
          >
            今日
          </button>
        )}
      </div>

      <WeekStrip
        days={days}
        selected={selected}
        today={today}
        marked={marked}
        onSelect={setSelected}
        onShiftWeek={/* 操作内容に合わせて選択日を更新する。 */ (d) => setSelected(addDaysStr(selected, d * 7))}
      />

      <SprintOverdueBanner />

      <div className="timeline-sheet flex min-h-0 flex-1 flex-col">
      <UnplacedTray
        issues={unplaced}
        drag={drag}
        hasSprint={sprint !== null}
        onOpen={/* 対象Issueの編集画面を開く。 */ (i) => setEditor({ issue: i })}
        shouldSuppressClick={shouldSuppressClick}
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <div ref={scrollerRef} className="timeline-scroller min-h-0 flex-1 overflow-y-auto pb-28 pt-3">
        <TimelineGrid
          gridRef={gridRef}
          range={range}
          blocks={scheduled}
          drag={drag}
          trayDurationMin={settings.defaultDuration}
          nowMin={nowLine}
          doneIds={doneIds}
          onCreateAt={/* 新規Issueの作成画面を開く。 */ (startMin) => setEditor({ create: { startMin } })}
          onOpen={/* 対象Issueの編集画面を開く。 */ (i) => setEditor({ issue: i })}
          onToggleDone={/* 完了状態の切替を共通のエラー処理付きで実行する。 */ (i) => void run(/* 対象Issueの完了・未完了状態を切り替える処理を呼び出す。 */ () => toggleIssueDone(i.id))}
          shouldSuppressClick={shouldSuppressClick}
        />
      </div>
      </div>

      <button
        aria-label="Issueを作成"
        onClick={/* 新規Issueの作成画面を開く。 */ () => setEditor({ create: { startMin: null } })}
        className="app-fab"
      >
        +
      </button>

      {editor && (
        <IssueEditor
          key={'issue' in editor ? editor.issue.id : `new-${editor.create.startMin}`}
          issue={'issue' in editor ? editor.issue : null}
          defaultSprintId={sprint?.id ?? null}
          initialSchedule={
            'create' in editor
              ? {
                  date: selected,
                  startMin:
                    editor.create.startMin === null
                      ? null
                      : clampMove(editor.create.startMin, settings.defaultDuration, range),
                }
              : undefined
          }
          onClose={/* Issue編集画面を閉じる。 */ () => setEditor(null)}
        />
      )}
    </div>
  )
}
