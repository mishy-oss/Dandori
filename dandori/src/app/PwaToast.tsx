import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect, useState } from 'react'
import { fetchUpdateNotes, formatCommitDate, type UpdateNotes } from './updateNotes'

export function PwaToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()
  const [notes, setNotes] = useState<UpdateNotes | 'error' | null>(null)

  useEffect(() => {
    if (!needRefresh) return
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 8_000)
    void fetchUpdateNotes(import.meta.env.VITE_APP_COMMIT ?? '', controller.signal)
      .then((result) => { if (active) setNotes(result) })
      .catch(() => { if (active) setNotes('error') })
      .finally(() => window.clearTimeout(timeout))
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [needRefresh])

  if (!needRefresh && !offlineReady) return null

  const close = () => {
    setNeedRefresh(false)
    setOfflineReady(false)
    setNotes(null)
  }

  return (
    <div
      role="status"
      className="fixed inset-x-4 z-50 mx-auto flex max-h-[60dvh] max-w-xl flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
    >
      <p className="flex-1 text-sm">
        {needRefresh
          ? '新しいバージョンがあります'
          : 'オフラインで使えるようになりました'}
      </p>
      {needRefresh && <div className="text-xs text-muted">
        {notes === null ? <p>更新内容を読み込み中…</p> : notes === 'error' ? <p>更新内容を取得できませんでした。アプリの更新はできます。</p> : <>
          <p className="mb-2 font-medium">最近の更新</p>
          {notes.entries.length > 0 ? <ul className="list-disc space-y-1 pl-4">
            {notes.entries.map((entry) => <li key={entry.sha} className="break-words">
              {entry.date && <time dateTime={entry.date} className="mr-2 text-muted">{formatCommitDate(entry.date)}</time>}
              {entry.message}
            </li>)}
          </ul> : <p>表示できる変更はありません。</p>}
        </>}
      </div>}
      <div className="flex items-center justify-end gap-3">
      {needRefresh && (
        <button
          className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text"
          onClick={() => updateServiceWorker(true)}
        >
          更新
        </button>
      )}
      <button
        className="min-h-11 rounded-lg px-3 text-sm text-muted"
        onClick={close}
      >
        閉じる
      </button>
      </div>
    </div>
  )
}
