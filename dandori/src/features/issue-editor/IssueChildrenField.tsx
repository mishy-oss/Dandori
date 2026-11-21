import { formatIssueNumber } from '../../lib/issueNumber'
import type { IssueEditorForm } from './useIssueEditorForm'
import { FIELD_CLASS as FIELD } from '../../app/fields'

type Props = Pick<IssueEditorForm,
  | 'issue'
  | 'workflow'
  | 'children'
  | 'detachingId'
  | 'setRelatedIssueId'
  | 'detachParent'
  | 'childTitle'
  | 'setChildTitle'
  | 'addingChild'
  | 'addChild'
>

export function IssueChildrenField({
  issue, workflow, children, detachingId,
  setRelatedIssueId, detachParent, childTitle, setChildTitle,
  addingChild, addChild,
}: Props) {
  return <>
    {issue && (
      <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-semibold text-muted">
          子タスク ({children.length})
        </legend>
        {children.length > 0 && <p className="text-xs text-muted">親のステータスは子タスクの進捗に連動します。子タスクを押すと編集できます。「外す」はタスクを残して親子関係だけを解除し、すぐに保存します。</p>}
        {children.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {children.map((child) => (
              <li key={child.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
                <span className="shrink-0 text-xs text-muted">{child.type === 'epic' ? 'Epic' : child.type} · {formatIssueNumber(child.number)}</span>
                <button type="button" aria-label={`${child.title}を編集`} disabled={detachingId !== null} className="min-h-11 min-w-0 flex-1 truncate text-left text-accent disabled:opacity-40"
                  onClick={() => setRelatedIssueId(child.id)}>{child.title}</button>
                <span className="shrink-0 text-xs text-muted">{workflow?.statuses.find((s) => s.id === child.statusId)?.name}</span>
                <button type="button" aria-label={`${child.title}を親タスクから外す`} disabled={detachingId !== null}
                  className="min-h-11 min-w-11 shrink-0 rounded-lg border border-border px-2 text-xs disabled:opacity-40"
                  onClick={() => void detachParent(child)}>{detachingId === child.id ? '解除中…' : '外す'}</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">子Issueはまだありません</p>
        )}
        <div className="flex gap-2">
          <input
            aria-label="子Issueのタイトル"
            className={`${FIELD} min-w-0 flex-1`}
            placeholder="サブタスクを追加"
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void addChild()
              }
            }}
          />
          <button
            type="button"
            disabled={!childTitle.trim() || addingChild}
            onClick={() => void addChild()}
            className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          >
            追加
          </button>
        </div>
      </fieldset>
    )}
  </>
}
