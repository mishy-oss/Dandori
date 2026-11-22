import { useId, useMemo, useRef, useState } from 'react'
import type { Issue, WorkflowStatus } from '../../db/types'
import { FIELD_CLASS } from '../../app/fields'
import { displayInputDate } from '../../app/dateInput'
import { formatIssueNumber } from '../../lib/issueNumber'
import { issueMonth } from '../../lib/month'
import { formatMin } from '../timeline/timelineLogic'
import { searchParentTasks } from './parentTasks'

const PAGE_SIZE = 20

export function ParentTaskPicker({ options, value, selectedParent, statuses, disabled = false, onChange }: {
  options: Issue[]
  value: string | null
  selectedParent?: Issue
  statuses: WorkflowStatus[]
  disabled?: boolean
  onChange: (id: string) => void
}) {
  const id = useId()
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const summaryRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const results = useMemo(() => searchParentTasks(options, query), [options, query])
  const parent = selectedParent ?? options.find(issue => issue.id === value)

  function close() {
    if (detailsRef.current) detailsRef.current.open = false
    summaryRef.current?.focus()
  }

  function description(issue: Issue) {
    const status = statuses.find(status => status.id === issue.statusId)?.name ?? ''
    const date = issue.date ? `${displayInputDate(issue.date)}${issue.startMin === null ? '' : ` ${formatMin(issue.startMin)}`}` : `対象月 ${issueMonth(issue)}`
    return [issue.type, status, date].filter(Boolean).join(' · ')
  }

  return <details ref={detailsRef} className="min-w-0 rounded-lg border border-border bg-surface-2"
    onToggle={event => { if (event.currentTarget.open) searchRef.current?.focus() }}>
    <summary ref={summaryRef} aria-label={value ? '親タスクを変更' : '親タスクを選ぶ'} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : 0}
      onClick={event => { if (disabled) event.preventDefault() }}
      className={`flex min-h-11 list-none items-center gap-2 p-3 [&::-webkit-details-marker]:hidden ${disabled ? 'cursor-default opacity-40' : 'cursor-pointer'}`}>
      <span className="min-w-0 flex-1 text-sm text-text">
        <span className="block break-words font-medium">{parent ? `${formatIssueNumber(parent.number)} · ${parent.title}` : value ? '選択中の親タスクを表示できません' : '親タスクなし'}</span>
        {parent && <span className="mt-1 block text-xs text-muted">{description(parent)}</span>}
      </span>
      <span aria-hidden className="shrink-0 text-xs text-accent">{value ? '変更' : '選択'} ▾</span>
    </summary>
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-2 border-t border-border p-3">
      <label htmlFor={`${id}-search`} className="text-xs text-muted">タイトル・番号で検索</label>
      <div className="flex min-w-0 gap-2">
        <input ref={searchRef} id={`${id}-search`} type="search" aria-label="親タスクを検索" aria-describedby={`${id}-hint`} autoComplete="off"
          placeholder="例：会議、#123" value={query} className={`${FIELD_CLASS} min-w-0 flex-1`}
          onChange={event => { setQuery(event.target.value); setLimit(PAGE_SIZE) }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
            if (event.key === 'Enter') event.preventDefault()
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
          }} />
        <button type="button" disabled={!query} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-xs disabled:opacity-40"
          onClick={() => { setQuery(''); setLimit(PAGE_SIZE); searchRef.current?.focus() }}>クリア</button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">候補を選んでください。検索中のEnterではタスクを保存しません。</p>
      <p role="status" className="text-xs text-muted">候補 {results.length}件 · {Math.min(limit, results.length)}件表示{!query && '（更新が新しい順）'}</p>
      <ul aria-label="親タスクの検索結果" className="max-h-64 min-w-0 overflow-y-auto rounded-lg border border-border bg-surface">
        {results.slice(0, limit).map(issue => <li key={issue.id} className="border-b border-border last:border-b-0">
          <button type="button" aria-label={`${formatIssueNumber(issue.number)} ${issue.title}を親タスクに設定`} aria-pressed={issue.id === value}
            className={`min-h-11 w-full p-3 text-left text-text ${issue.id === value ? 'bg-accent/10' : 'hover:bg-surface-2'}`}
            onClick={() => { onChange(issue.id); setQuery(''); setLimit(PAGE_SIZE); close() }}>
            <span className="block break-words text-sm">{issue.id === value && '✓ '}{formatIssueNumber(issue.number)} · {issue.title}</span>
            <span className="mt-1 block text-xs text-muted">{description(issue)}</span>
          </button>
        </li>)}
        {results.length === 0 && <li className="p-3 text-sm text-muted">{options.length ? '条件に合う親タスクがありません。検索語を変えてください。' : '選べる親タスクがありません。親にしたいタスクを先に作成してください。'}</li>}
      </ul>
      {results.length > limit && <button type="button" className="min-h-11 rounded-lg border border-border px-3 text-xs" onClick={() => setLimit(limit + PAGE_SIZE)}>さらに{Math.min(PAGE_SIZE, results.length - limit)}件表示</button>}
      <button type="button" className="min-h-11 text-xs text-accent" onClick={close}>候補を閉じる</button>
    </fieldset>
  </details>
}
