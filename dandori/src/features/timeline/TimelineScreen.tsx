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

export function TimelineScreen() {
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const sprint = useDataStore(selectActiveSprint)
  const issues = useDataStore((s) => s.issues)
  const settings = useDataStore((s) => s.settings)
  const ready = useDataStore((s) => s.ready)
  const scheduleIssue = useDataStore((s) => s.scheduleIssue)
  const toggleIssueDone = useDataStore((s) => s.toggleIssueDone)

  const now = useNow()
  const today = todayStr(now)
  const [selected, setSelected] = useState(() => todayStr())
  const [editor, setEditor] = useState<EditorState>(null)
  const [error, setError] = useState<string | null>(null)

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
    () =>
      sprint
        ? issues.filter(
            (i) => i.sprintId === sprint.id && i.startMin === null && i.type !== 'epic' && !doneIds.has(i.statusId),
          )
        : [],
    [issues, sprint, doneIds],
  )
  const range = useMemo(
    () =>
      visibleRange(
        settings.dayStartHour,
        settings.dayEndHour,
        scheduled.map((i) => ({ id: i.id, startMin: i.startMin!, durationMin: i.durationMin })),
      ),
    [settings.dayStartHour, settings.dayEndHour, scheduled],
  )
  const days = weekDays(selected, settings.weekStartsOn)
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

  // 日付を切り替えたとき(今日なら現在時刻の少し前、それ以外は先頭)へスクロールする
  const rangeStart = range.startMin
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !ready) return
    const target = selected === todayStr() ? Math.max(rangeStart, nowMin() - 60) : rangeStart
    scroller.scrollTop = (target - rangeStart) * PX_PER_MIN
  }, [selected, ready, rangeStart])

  if (!ready || !project) return null

  const title = format(parseISO(selected), 'M月d日(E)', { locale: ja })
  const nowLine = selected === today ? nowMin(now) : null

  return (
    <div ref={rootRef} onPointerDown={onPointerDown} className="flex h-full flex-col gap-2 px-4 pt-4">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold">
          {selected === today ? 'Today' : title}
          {selected === today && <span className="ml-2 text-sm font-normal text-muted">{title}</span>}
        </h1>
        {selected !== today && (
          <button
            onClick={() => setSelected(todayStr())}
            className="min-h-11 rounded-lg border border-border bg-surface px-4 text-sm"
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
        onShiftWeek={(d) => setSelected(addDaysStr(selected, d * 7))}
      />

      <SprintOverdueBanner />

      <UnplacedTray
        issues={unplaced}
        drag={drag}
        hasSprint={sprint !== null}
        onOpen={(i) => setEditor({ issue: i })}
        shouldSuppressClick={shouldSuppressClick}
      />

      {error && (
        <p role="alert" className="rounded-lg border border-red-500 p-2 text-sm text-red-500">
          {error}
        </p>
      )}

      <div ref={scrollerRef} className="-mx-4 flex-1 overflow-y-auto pb-24 pt-3">
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

      <button
        aria-label="Issueを作成"
        onClick={() => setEditor({ create: { startMin: null } })}
        className="fixed right-4 z-30 flex size-14 items-center justify-center rounded-full bg-accent text-3xl text-accent-text shadow-lg"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
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
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  )
}
