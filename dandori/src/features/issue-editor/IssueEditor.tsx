import { FIELD_CLASS as FIELD } from '../../app/fields'
import { formatIssueNumber } from '../../lib/issueNumber'
import { DeleteIssueDialog } from './DeleteIssueDialog'
import { CarryoverDialog } from './CarryoverDialog'
import { useIssueEditorForm, type IssueEditorProps } from './useIssueEditorForm'
import { IssueLabelsField } from './IssueLabelsField'
import { IssueRecurrenceFields } from './IssueRecurrenceFields'
import { IssueScheduleFields } from './IssueScheduleFields'
import { IssueMetadataFields } from './IssueMetadataFields'
import { IssueParentField } from './IssueParentField'
import { IssueChildrenField } from './IssueChildrenField'
import { IssueHistoryView } from './IssueHistoryView'

export function IssueEditor(props: IssueEditorProps) {
  const editor = useIssueEditorForm(props)
  const {
    issue, workflow, issues, relatedIssue, setRelatedIssueId,
    setShowCarryover, title, setTitle, description, setDescription,
    isRoutine, column, position, reorder, error,
    onSubmit, detachingId, saving, onClose, setShowDelete, showDelete,
    descendants, deleteIssue, showCarryover,
  } = editor

  if (issue?.carryoverToId) {
    const destination = issues.find(item => item.id === issue.carryoverToId)
    return <>
      <IssueHistoryView issue={issue} destination={destination} hidden={!!relatedIssue} onOpen={setRelatedIssueId} onClose={onClose} />
      {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue} onClose={onClose} />}
    </>
  }

  return (
    <><div className={`${relatedIssue ? 'hidden' : 'flex'} fixed inset-0 z-40 items-end bg-black/50`} onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label={issue ? 'Issueを編集' : 'Issueを作成'}
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        <h2 className="text-lg font-bold">
          {issue ? formatIssueNumber(issue.number) : '新規タスク'}
        </h2>
        {issue?.carryoverFromId && <p className="text-xs text-muted">{issues.find(item => item.id === issue.carryoverFromId)?.date ?? '過去の予定'}から持ち越し</p>}
        {issue?.date && !workflow?.statuses.some(status => status.id === issue.statusId && status.category === 'done') && <>
          <button type="button" className="min-h-11 rounded-lg border border-accent px-3 text-sm text-accent" onClick={() => setShowCarryover(true)}>翌日以降へ持ち越す</button>
          <p className="text-xs text-muted">持ち越しは保存済みの内容を引き継ぎます。編集中の変更は先に保存してください。</p>
        </>}

        <label className="flex flex-col gap-1 text-sm text-muted">
          タイトル
          <input
            className={FIELD}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus={!issue}
          />
        </label>

        <IssueLabelsField {...editor} />

        <IssueRecurrenceFields {...editor} />

        <label className="flex flex-col gap-1 text-sm text-muted">
          説明
          <textarea
            className={`${FIELD} min-h-24 py-2`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <IssueMetadataFields {...editor} parentField={<IssueParentField {...editor} />} />

        <IssueScheduleFields {...editor} />

        {isRoutine && <p className="text-xs text-muted">Recurring：会議など決まった時間の予定に使います。日付・開始時刻と、必要に応じて繰り返しを設定してください。</p>}
        <IssueChildrenField {...editor} />

        {issue && column.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-muted">
              列内の並び順({position + 1}/{column.length})
            </span>
            <button
              type="button"
              aria-label="列内で上へ移動"
              disabled={position <= 0}
              onClick={() => void reorder(-1)}
              className="min-h-11 min-w-11 rounded-lg border border-border disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label="列内で下へ移動"
              disabled={position < 0 || position >= column.length - 1}
              onClick={() => void reorder(1)}
              className="min-h-11 min-w-11 rounded-lg border border-border disabled:opacity-40"
            >
              ↓
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {issue && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-red-500 px-4 text-sm text-red-500"
              onClick={() => setShowDelete(true)}
            >
              削除
            </button>
          )}
          <button
            type="button"
            className="min-h-11 flex-1 rounded-lg border border-border px-4 text-sm"
            onClick={onClose}
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={detachingId !== null || saving}
            className="min-h-11 flex-1 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text disabled:opacity-40"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
    {showDelete && issue && <DeleteIssueDialog title={issue.title} descendantCount={descendants.size}
      onDelete={() => deleteIssue(issue.id)}
      onClose={() => setShowDelete(false)}
      onDeleted={onClose} />}
    {showCarryover && issue && <CarryoverDialog issue={issue} onClose={() => setShowCarryover(false)}
      onCreated={next => { setShowCarryover(false); setRelatedIssueId(next.id) }} />}
    {relatedIssue && <IssueEditor key={relatedIssue.id} issue={relatedIssue}
      onClose={() => setRelatedIssueId(null)} />}
    </>
  )
}
