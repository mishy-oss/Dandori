import { useId, useRef } from 'react'
import { appendIssueLabel } from './issueEditorLogic'
import { labelKey, normalizeIssueLabels, normalizeLabel, suggestIssueLabels } from '../../lib/labels'
import type { IssueEditorForm } from './useIssueEditorForm'
import { FIELD_CLASS as FIELD } from '../../app/fields'

type Props = Pick<IssueEditorForm,
  | 'labels'
  | 'setLabels'
  | 'labelDraft'
  | 'setLabelDraft'
  | 'knownLabels'
>

export function IssueLabelsField({
  labels, setLabels, labelDraft, setLabelDraft,
  knownLabels,
}: Props) {
  const labelInputRef = useRef<HTMLInputElement>(null)
  const labelHelpId = useId()
  const selectedLabels = normalizeIssueLabels(labels, knownLabels)
  const labelSuggestions = suggestIssueLabels(knownLabels, selectedLabels, labelDraft)
  function addLabel(value: string) {
    setLabels(appendIssueLabel(selectedLabels, value, knownLabels))
    setLabelDraft('')
    labelInputRef.current?.focus()
  }
  return <>
    <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-sm font-semibold text-muted">ラベル</legend>
      <div className="flex gap-2">
        <input ref={labelInputRef} aria-label="追加するラベル" aria-describedby={labelHelpId} autoComplete="off" className={`${FIELD} min-w-0 flex-1`} value={labelDraft} placeholder="既存のラベルを選択、または新しく入力"
          onChange={(event) => setLabelDraft(event.target.value)}
          onKeyDown={(event) => {
            // IMEの変換確定をラベル追加として扱わない。
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault()
              addLabel(labelDraft)
            }
          }} />
        <button type="button" disabled={!normalizeLabel(labelDraft)} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40"
          onClick={() => addLabel(labelDraft)}>追加</button>
      </div>
      <p id={labelHelpId} className="text-[11px] text-muted">候補を押すと追加できます。前後・連続する空白、全角・半角、英字の大小文字の違いは同じラベルとして扱います。</p>
      {labelSuggestions.length > 0 ? <div>
        <p className="mb-1 text-xs text-muted">既存のラベルから選択</p>
        <ul aria-label="ラベルの候補" className="flex max-h-36 flex-wrap gap-2 overflow-y-auto">
          {labelSuggestions.map(label => <li key={labelKey(label)} className="max-w-full">
            <button type="button" aria-label={`${label}のラベルを追加`} className="min-h-11 max-w-full break-words rounded-lg border border-border px-3 text-left text-sm text-accent" onClick={() => addLabel(label)}>{label}</button>
          </li>)}
        </ul>
      </div> : labelDraft && <p role="status" className="text-xs text-muted">{selectedLabels.some(label => labelKey(label) === labelKey(labelDraft)) ? 'このラベルは追加済みです。' : '一致する候補がありません。「追加」で新しいラベルを作成できます。'}</p>}
      {selectedLabels.length > 0 && <ul aria-label="追加済みのラベル" className="flex flex-wrap gap-2">
        {selectedLabels.map((label) => <li key={labelKey(label)} className="flex max-w-full items-center gap-1 rounded-lg bg-surface-2 pl-3 text-sm">
          <span className="break-words">{label}</span>
          <button type="button" aria-label={`${label}のラベルを削除`} className="min-h-11 min-w-11 shrink-0"
            onClick={() => setLabels(selectedLabels.filter(selected => labelKey(selected) !== labelKey(label)))}>×</button>
        </li>)}
      </ul>}
    </fieldset>
  </>
}
