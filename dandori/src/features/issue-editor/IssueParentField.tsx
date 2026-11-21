import { ParentTaskPicker } from './ParentTaskPicker'
import type { IssueEditorForm } from './useIssueEditorForm'

type Props = Pick<IssueEditorForm,
  | 'parentOptions'
  | 'parentId'
  | 'issues'
  | 'workflow'
  | 'detachingId'
  | 'setParentId'
  | 'setRelatedIssueId'
  | 'issue'
  | 'issueId'
  | 'detachParent'
>

export function IssueParentField({
  parentOptions, parentId, issues, workflow,
  detachingId, setParentId, setRelatedIssueId, issue,
  issueId, detachParent,
}: Props) {
  return <>
      <div className="col-span-2 flex min-w-0 flex-col gap-2 text-sm text-muted">
        <span>親タスク / Epic</span>
        <p className="text-xs">大きな作業の下にまとめたいときに選びます。親の設定・変更はタスク保存時に反映します。</p>
        <ParentTaskPicker options={parentOptions} value={parentId} selectedParent={issues.find(parent => parent.id === parentId)} statuses={workflow?.statuses ?? []}
          disabled={detachingId !== null} onChange={setParentId} />
        {parentId && <>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={detachingId !== null} className="min-h-11 text-left text-xs text-accent disabled:opacity-40"
              onClick={() => setRelatedIssueId(parentId)}>親タスクを編集</button>
            <button type="button" disabled={detachingId !== null} className="min-h-11 rounded-lg border border-border px-3 text-xs disabled:opacity-40"
              onClick={() => { if (issue?.parentId) void detachParent(issue); else setParentId(null) }}>{detachingId === issueId ? '解除中…' : '親を外す'}</button>
          </div>
          <span className="text-xs">{issue?.parentId ? 'タスクは残し、親子関係だけを外します。解除はすぐに保存されます。' : '親の選択を解除します。'}</span>
        </>}
      </div>
  </>
}
