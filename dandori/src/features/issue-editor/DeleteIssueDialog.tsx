import { useEffect, useRef, useState } from 'react'

export function DeleteIssueDialog({ title, descendantCount, onDelete, onClose, onDeleted }: {
  title: string
  descendantCount: number
  onDelete: () => Promise<void>
  onClose: () => void
  onDeleted: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const deletingRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])

  async function remove() {
    if (deletingRef.current) return
    deletingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onDelete()
      onDeleted()
    } catch (cause) {
      deletingRef.current = false
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return <dialog ref={dialogRef} role="alertdialog" aria-labelledby="delete-issue-title" aria-describedby="delete-issue-description"
    className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-2xl border border-border bg-surface p-4 text-text shadow-xl backdrop:bg-black/50"
    onCancel={(event) => { event.preventDefault(); if (!deletingRef.current) onClose() }}>
    <h2 id="delete-issue-title" className="mb-3 text-lg font-bold">タスクを削除しますか？</h2>
    <p id="delete-issue-description" className="break-words text-sm">
      「{title}」を削除します。{descendantCount > 0 && `子タスク${descendantCount}件も一緒に削除されます。`}
    </p>
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <div className="mt-4 flex gap-3">
      <button type="button" autoFocus disabled={busy} onClick={onClose} className="min-h-11 flex-1 rounded-lg border border-border px-3 disabled:opacity-40">キャンセル</button>
      <button type="button" disabled={busy} onClick={() => void remove()} className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 text-white disabled:opacity-40">{busy ? '削除中…' : '削除する'}</button>
    </div>
  </dialog>
}
