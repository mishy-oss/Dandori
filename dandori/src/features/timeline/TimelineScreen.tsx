import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Issue } from '../../db/types'
import { addDaysStr, todayStr } from '../../lib/date'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { issueMonth } from '../../lib/month'
import { IssueEditor } from '../issue-editor/IssueEditor'
import { TimelineGrid } from './TimelineGrid'
import { UnplacedTray } from './UnplacedTray'
import { WeekStrip } from './WeekStrip'
import { PX_PER_MIN, clampMove, nowMin, visibleRange, weekDays } from './timelineLogic'
import { useNow } from './useNow'
import { useTimelineGestures } from './useTimelineGestures'
import { DateJumpButton } from '../../app/DateJumpButton'
import { CarryoverDialog } from '../issue-editor/CarryoverDialog'
import { currentWork } from '../../lib/carryover'

type EditorState = { issue: Issue } | { create: { startMin: number | null } } | null

export function TimelineScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const selectMonth = useDataStore((state) => state.selectMonth)
  const issues = useDataStore((s) => s.issues)
  const settings = useDataStore((s) => s.settings)
  const ready = useDataStore((s) => s.ready)
  const scheduleIssue = useDataStore((s) => s.scheduleIssue)
  const toggleIssueDone = useDataStore((s) => s.toggleIssueDone)

  const now = useNow()
  const today = todayStr(now)
  const [selected, setSelected] = useState(() => todayStr())
  const [todayJump, setTodayJump] = useState(0)
  const [editor, setEditor] = useState<EditorState>(null)
  const [carrying, setCarrying] = useState<Issue | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (useDataStore.getState().selectedMonth !== selected.slice(0, 7)) void selectMonth(selected.slice(0, 7)).catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [selected, selectMonth])

  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)

  const doneIds = useMemo(
    () => new Set((workflow?.statuses ?? []).filter((s) => s.category === 'done').map((s) => s.id)),
    [workflow],
  )
  const scheduled = useMemo(
    () => issues.filter((i) => i.date === selected && i.startMin !== null),
    [issues, selected],
  )
  const unplaced = useMemo(
    () => currentWork(issues).filter((issue) => issueMonth(issue) === selected.slice(0, 7) && issue.startMin === null && !issue.calendarAllDay && issue.type !== 'epic' && !doneIds.has(issue.statusId)),
    [issues, selected, doneIds],
  )
  const range = useMemo(
    () => {
      const visible = visibleRange(
        settings.dayStartHour,
        settings.dayEndHour,
        scheduled.map((i) => ({ id: i.id, startMin: i.startMin!, durationMin: i.durationMin })),
      )
      // 今日へのジャンプ時は、現在時刻が設定の時間帯の外でも表示できるようにする。
      if (todayJump > 0 && selected === todayStr()) {
        const minute = nowMin()
        return { startMin: Math.min(visible.startMin, Math.floor(minute / 60) * 60), endMin: Math.max(visible.endMin, Math.ceil((minute + 1) / 60) * 60) }
      }
      return visible
    },
    [settings.dayStartHour, settings.dayEndHour, scheduled, selected, todayJump],
  )
  const days = weekDays(selected, settings.weekStartsOn)
  const overdue = currentWork(issues).filter(issue => issue.date && issue.date < selected && (issue.startMin !== null || issue.calendarAllDay) && issue.type !== 'epic' && !doneIds.has(issue.statusId))
  const marked = useMemo(
    () => new Set(issues.filter((i) => i.date !== null && i.startMin !== null).map((i) => i.date!)),
    [issues],
  )

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
    getBlock: (id) => {
      const i = issues.find((x) => x.id === id)
      return i && i.startMin !== null ? { startMin: i.startMin, durationMin: i.durationMin } : undefined
    },
    getTrayDuration: (id) => issues.find((x) => x.id === id)?.durationMin ?? settings.defaultDuration,
    onMove: (id, startMin) => void run(() => scheduleIssue(id, { date: selected, startMin })),
    onResize: (id, durationMin) => {
      const i = issues.find((x) => x.id === id)
      if (i) void run(() => scheduleIssue(id, { date: i.date, startMin: i.startMin, durationMin }))
    },
    onResizeTop: (id, startMin, durationMin) => {
      const i = issues.find((x) => x.id === id)
      if (i) void run(() => scheduleIssue(id, { date: i.date, startMin, durationMin }))
    },
    onPlace: (id, startMin) => void run(() => scheduleIssue(id, { date: selected, startMin })),
  })

  const rangeStart = range.startMin
  function jumpToToday() {
    setSelected(todayStr())
    setTodayJump((count) => count + 1)
  }

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !ready) return
    const leadMinutes = Math.min(60, scroller.clientHeight / (PX_PER_MIN * 3))
    const target = selected === todayStr() ? Math.max(rangeStart, nowMin() - leadMinutes) : rangeStart
    scroller.scrollTop = (target - rangeStart) * PX_PER_MIN
  }, [selected, ready, rangeStart, todayJump])

  if (!ready || !project) return null

  const title = format(parseISO(selected), 'M月d日', { locale: ja })
  const nowLine = selected === today ? nowMin(now) : null

  return (
    <div ref={rootRef} onPointerDown={onPointerDown} className="flex h-full min-h-0 flex-col pt-6">
      <div className="flex shrink-0 items-center gap-2 px-6 pb-2">
        <h1 className="flex-1 text-[25px] font-semibold tracking-[-0.04em]">
          <span className="mr-2 font-medium text-accent">{format(parseISO(selected), 'yyyy年')}</span>{title}
        </h1>
        <DateJumpButton aria-label="今日へジャンプ" title="今日の現在時刻へ移動" onClick={jumpToToday}>
          今日へ
        </DateJumpButton>
      </div>

      <WeekStrip
        days={days}
        selected={selected}
        today={today}
        marked={marked}
        onSelect={setSelected}
        onShiftWeek={(d) => setSelected(addDaysStr(selected, d * 7))}
      />


      <div className="timeline-sheet flex min-h-0 flex-1 flex-col">
      {overdue.length > 0 && <details data-no-drag className="mx-4 mt-3 shrink-0 rounded-xl border border-border bg-surface px-3 text-xs">
        <summary className="min-h-11 cursor-pointer py-3">過去の未完了（{overdue.length}件）</summary>
        <ul className="max-h-48 overflow-y-auto">{overdue.sort((a, b) => a.date!.localeCompare(b.date!)).map(issue => <li key={issue.id} className="flex items-center gap-2 border-t border-border">
          <button type="button" className="min-h-11 min-w-0 flex-1 truncate text-left" onClick={() => setEditor({ issue })}>{issue.date} · {issue.title}</button>
          <button type="button" className="min-h-11 shrink-0 px-2 text-accent" onClick={() => setCarrying(issue)}>この日へ持ち越す</button>
        </li>)}</ul>
      </details>}
      {issues.some(issue => issue.date === selected && issue.calendarAllDay) && <section aria-label="終日予定" className="flex shrink-0 flex-wrap gap-2 px-4 py-2">
        <span className="self-center text-xs text-muted">終日</span>
        {issues.filter(issue => issue.date === selected && issue.calendarAllDay).map(issue => <button key={issue.id} data-no-drag onClick={() => setEditor({ issue })} className="min-h-11 rounded-lg border border-border px-3 text-sm">{issue.title}</button>)}
      </section>}
      <UnplacedTray
        issues={unplaced}
        drag={drag}
        onOpen={(i) => setEditor({ issue: i })}
        shouldSuppressClick={shouldSuppressClick}
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <div ref={scrollerRef} className="timeline-scroller min-h-0 flex-1 overflow-auto pb-28 pt-3">
        <TimelineGrid
          gridRef={gridRef}
          range={range}
          blocks={scheduled}
          drag={drag}
          trayDurationMin={settings.defaultDuration}
          nowMin={nowLine}
          doneIds={doneIds}
          onCreateAt={(startMin) => setEditor({ create: { startMin } })}
          onOpen={(i) => setEditor({ issue: i })}
          onToggleDone={(i) => void run(() => toggleIssueDone(i.id))}
          shouldSuppressClick={shouldSuppressClick}
        />
      </div>
      </div>

      <button
        aria-label="Issueを作成"
        onClick={() => setEditor({ create: { startMin: null } })}
        className="app-fab"
      >
        +
      </button>

      {editor && (
        <IssueEditor
          key={'issue' in editor ? editor.issue.id : `new-${editor.create.startMin}`}
          issue={'issue' in editor ? editor.issue : null}
          defaultPlanningMonth={selected.slice(0, 7)}
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
          onClose={() => setEditor(null)}
        />
      )}
      {carrying && <CarryoverDialog issue={carrying} targetDate={selected} onClose={() => setCarrying(null)} onCreated={next => { setCarrying(null); setEditor({ issue: next }) }} />}
    </div>
  )
}
