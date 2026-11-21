import { useMemo, useState, type FormEvent } from 'react'
import type { Issue, IssueType, Priority, RecurrenceFrequency } from '../../db/types'
import { todayStr } from '../../lib/date'
import { currentMonth, isValidMonth, issueMonth } from '../../lib/month'
import { selectCurrentProject, useDataStore } from '../../store/data'
import { formatMin, parseTime } from '../timeline/timelineLogic'
import { appendIssueLabel, scheduledEditorStatusId } from './issueEditorLogic'
import { currentWork } from '../../lib/carryover'
import { createScheduleInput, scheduleInputError, updateScheduleInput } from './scheduleInput'
import type { RecurringEditScope } from '../../db/recurringEditRepo'
import { existingIssueLabels } from '../../lib/labels'
import { descendantTaskIds, parentTaskOptions } from './parentTasks'

export interface IssueEditorProps {
  issue: Issue | null
  defaultStatusId?: string
  defaultPlanningMonth?: string
  initialSchedule?: { date: string | null; startMin: number | null }
  onClose: () => void
}

export function useIssueEditorForm({ issue: initialIssue, defaultStatusId, defaultPlanningMonth = currentMonth(), initialSchedule, onClose }: IssueEditorProps) {
  const issue = useDataStore(state => initialIssue ? state.issues.find(item => item.id === initialIssue.id) ?? initialIssue : null)
  const project = useDataStore(selectCurrentProject)
  const workflow = useDataStore((s) => (project ? s.workflows[project.workflowId] : undefined))
  const defaultDuration = useDataStore((s) => s.settings.defaultDuration)
  const createIssue = useDataStore((s) => s.createIssue)
  const updateIssue = useDataStore((s) => s.updateIssue)
  const deleteIssue = useDataStore((s) => s.deleteIssue)
  const moveIssue = useDataStore((s) => s.moveIssue)
  const recurrenceRule = useDataStore((s) => s.recurrenceRules.find((rule) => rule.id === issue?.recurrenceId))
  const issues = useDataStore((s) => s.issues)
  // 並び順は同じステータス・同じ対象月の中で扱う。
  const column = useMemo(
    () =>
      issue
        ? currentWork(issues).filter((i) => i.statusId === issue.statusId && issueMonth(i) === issueMonth(issue))
        : [],
    [issues, issue],
  )
  const position = issue ? column.findIndex((i) => i.id === issue.id) : -1

  const [title, setTitle] = useState(issue?.title ?? '')
  const [description, setDescription] = useState(issue?.description ?? '')
  const [labels, setLabels] = useState<string[]>(issue?.labels ?? [])
  const [labelDraft, setLabelDraft] = useState('')
  const knownLabels = useMemo(() => existingIssueLabels(issues, project?.id ?? ''), [issues, project?.id])
  const [showDelete, setShowDelete] = useState(false)
  const [showCarryover, setShowCarryover] = useState(false)
  const [type, setType] = useState<IssueType>(issue?.type ?? 'task')
  const [priority, setPriority] = useState<Priority>(issue?.priority ?? 'medium')
  const [statusId, setStatusId] = useState(
    issue?.statusId ?? defaultStatusId ?? workflow?.statuses[0]?.id ?? '',
  )
  const [planningMonth, setPlanningMonth] = useState(issue ? issueMonth(issue) : initialSchedule?.date?.slice(0, 7) ?? defaultPlanningMonth)
  const savedParentId = issue?.parentId ?? null
  const [parentDraft, setParentDraft] = useState({ saved: savedParentId, value: savedParentId })
  // 関連画面から親子関係を外した後、古いフォームの保存で再接続しない。
  const parentId = parentDraft.saved === savedParentId ? parentDraft.value : savedParentId
  const setParentId = (value: string | null) => setParentDraft({ saved: savedParentId, value })
  const [dueDate, setDueDate] = useState(issue?.dueDate ?? '')
  const [date, setDate] = useState(issue?.date ?? initialSchedule?.date ?? '')
  const startInit = issue ? issue.startMin : (initialSchedule?.startMin ?? null)
  const [schedule, setSchedule] = useState(() => createScheduleInput(
    startInit === null ? '' : formatMin(startInit), String(issue?.durationMin ?? defaultDuration),
  ))
  const { startTime, endTime, duration } = schedule
  const setStartTime = (value: string) => setSchedule(current => updateScheduleInput(current, 'startTime', value))
  const setDuration = (value: string) => setSchedule(current => updateScheduleInput(current, 'duration', value))
  const [calendarAllDay, setCalendarAllDay] = useState(!!issue?.calendarAllDay)
  const [reminderOffsetMin, setReminderOffsetMin] = useState<number | null>(issue ? issue.reminderOffsetMin : 0)
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency | ''>(recurrenceRule?.frequency ?? '')
  const [recurrenceInterval, setRecurrenceInterval] = useState(String(recurrenceRule?.interval ?? 1))
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>(() =>
    recurrenceRule?.weekdays ?? [new Date(`${date || todayStr()}T00:00:00`).getDay()],
  )
  const [recurrenceEndDate, setRecurrenceEndDate] = useState(recurrenceRule?.endDate ?? '')
  const [editScope, setEditScope] = useState<RecurringEditScope>('single')
  const [error, setError] = useState<string | null>(null)
  const [childTitle, setChildTitle] = useState('')
  const [addingChild, setAddingChild] = useState(false)
  const [detachingId, setDetachingId] = useState<string | null>(null)
  // 元の入力内容を失わないよう、関連タスクは別の編集画面で開く。
  const [relatedIssueId, setRelatedIssueId] = useState<string | null>(null)
  const relatedIssue = issues.find((item) => item.id === relatedIssueId)
  const issueId = issue?.id

  const descendants = useMemo(() => descendantTaskIds(issues, issueId), [issues, issueId])
  const parentOptions = useMemo(() => parentTaskOptions(issues, project?.id ?? '', issueId), [issues, project?.id, issueId])
  const children = issueId ? currentWork(issues).filter((i) => i.parentId === issueId) : []
  const isRoutine = workflow?.statuses.find((status) => status.id === statusId)?.category === 'routine'

  async function reorder(delta: -1 | 1) {
    if (!issue) return
    try {
      await moveIssue(issue.id, issue.statusId, position + delta, issueMonth(issue))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function run(action: () => Promise<unknown>) {
    try {
      await action()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function addChild() {
    if (!issue || !childTitle.trim() || addingChild) return
    setAddingChild(true)
    try {
      await createIssue({ title: childTitle, type: 'task', parentId: issue.id, planningMonth })
      setChildTitle('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddingChild(false)
    }
  }

  async function detachParent(child: Issue) {
    if (detachingId) return
    setDetachingId(child.id)
    setError(null)
    try {
      await updateIssue(child.id, { parentId: null })
      if (child.id === issueId) setParentDraft({ saved: null, value: null })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDetachingId(null)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (detachingId) return
    if (!isValidMonth(planningMonth)) { setError('対象月を選択してください'); return }
    if (calendarAllDay && !date) { setError('終日予定の日付を指定してください'); return }
    const timeError = calendarAllDay ? null : scheduleInputError(schedule)
    if (timeError) { setError(timeError); return }
    const startMin = calendarAllDay ? null : startTime ? parseTime(startTime) : null
    if (!calendarAllDay && startTime && startMin === null) {
      setError('開始時刻が正しくありません')
      return
    }
    if (recurrence === 'weekly' && recurrenceWeekdays.length === 0) {
      setError('繰り返す曜日を1つ以上選択してください')
      return
    }
    const scheduleChanged = !issue || issue.date !== (date || null) || issue.startMin !== startMin
    const common = {
      labels: appendIssueLabel(labels, labelDraft, knownLabels),
      title,
      description: description || undefined,
      type,
      priority,
      statusId: scheduledEditorStatusId(workflow?.statuses ?? [], statusId, date || null, startMin, scheduleChanged),
      parentId,
      dueDate: dueDate || null,
      date: date || null,
      startMin,
      durationMin: calendarAllDay ? 1440 : Number(duration),
      calendarAllDay,
      reminderOffsetMin,
      planningMonth,
      sprintId: null,
    }
    void run(async () => {
      if (!issue) {
        await createIssue({
          ...common,
          ...(recurrence && {
            recurrence: {
              frequency: recurrence,
              interval: Number(recurrenceInterval),
              ...(recurrence === 'weekly' && { weekdays: recurrenceWeekdays }),
              endDate: recurrenceEndDate || null,
            },
          }),
        })
        return
      }
      await updateIssue(issue.id, {
        ...common,
        recurrence: recurrence
          ? {
              frequency: recurrence,
              interval: Number(recurrenceInterval),
              ...(recurrence === 'weekly' && { weekdays: recurrenceWeekdays }),
              endDate: recurrenceEndDate || null,
            }
          : null,
      }, issue.recurrenceId ? editScope : undefined)
    })
  }

  return {
    issue, issueId, workflow, issues, error,
    title, setTitle, description, setDescription,
    labels, setLabels, labelDraft, setLabelDraft, knownLabels,
    showDelete, setShowDelete, showCarryover, setShowCarryover,
    type, setType, priority, setPriority, statusId, setStatusId,
    planningMonth, setPlanningMonth, parentId, setParentId, dueDate, setDueDate,
    date, setDate, schedule, setSchedule, startTime, endTime, duration, setStartTime, setDuration,
    calendarAllDay, setCalendarAllDay, reminderOffsetMin, setReminderOffsetMin,
    recurrence, setRecurrence, recurrenceInterval, setRecurrenceInterval,
    recurrenceWeekdays, setRecurrenceWeekdays, recurrenceEndDate, setRecurrenceEndDate,
    editScope, setEditScope, recurrenceRule,
    childTitle, setChildTitle, addingChild, detachingId, relatedIssue, setRelatedIssueId,
    descendants, parentOptions, children, isRoutine, column, position,
    reorder, addChild, detachParent, onSubmit, deleteIssue, onClose,
  }
}

export type IssueEditorForm = ReturnType<typeof useIssueEditorForm>
