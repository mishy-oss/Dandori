import { useEffect, useRef, useState } from 'react'
import { fetchReleaseNotes, formatCommitDate, type UpdateNotes } from '../../app/updateNotes'

/** 利用中の版までのコミットをリリースノートとして表示する。閉じると元の情報ボタンへフォーカスが戻る。 */
export function ReleaseNotesDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [notes, setNotes] = useState<UpdateNotes | 'error' | null>(null)

  /** ダイアログの表示と通信を開始し、閉じる際や8秒経過後は通信を中断する。 */
  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    void fetchReleaseNotes(import.meta.env.VITE_APP_COMMIT ?? '', controller.signal)
      .then((result) => { if (active) setNotes(result) })
      .catch(() => { if (active) setNotes('error') })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout); dialog.close() }
  }, [])

  return <dialog ref={dialogRef} aria-labelledby="release-notes-title"
    className="fixed inset-0 m-auto max-h-[80dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border border-border bg-surface p-4 text-text shadow-xl backdrop:bg-black/50"
    onCancel={/* Escape操作でも画面の開閉状態を揃える。 */ (event) => { event.preventDefault(); onClose() }}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 id="release-notes-title" className="text-lg font-bold">リリースノート</h2>
      <button type="button" onClick={onClose} className="min-h-11 shrink-0 rounded-lg border border-border px-3 text-sm">閉じる</button>
    </div>
    <p className="mb-3 text-xs text-muted">現在のバージョンまでの最近の変更を最大5件表示します。日付はコミット日（日本時間）です。</p>
    {notes === null ? <p role="status" className="py-4 text-sm text-muted">読み込み中…</p>
      : notes === 'error' ? <div role="alert" className="text-sm text-muted">
        <p>リリースノートを取得できませんでした。通信環境を確認し、開き直してください。</p>
      </div> : <>
        {notes.entries.length ? <ul className="divide-y divide-border">
          {notes.entries.map((entry) => <li key={entry.sha} className="break-words py-3 text-sm">
            {entry.date && <time dateTime={entry.date} className="mb-1 block text-xs text-muted">{formatCommitDate(entry.date)}</time>}
            {entry.message}
          </li>)}
        </ul> : <p className="py-4 text-sm text-muted">表示できる変更はありません。</p>}
      </>}
  </dialog>
}
