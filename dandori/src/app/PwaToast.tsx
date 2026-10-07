import { useRegisterSW } from 'virtual:pwa-register/react'

export function PwaToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh && !offlineReady) return null

  const close = () => {
    setNeedRefresh(false)
    setOfflineReady(false)
  }

  return (
    <div
      role="status"
      className="fixed inset-x-4 z-50 flex items-center gap-3 rounded-xl border border-border bg-surface p-3 shadow-lg"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 72px)' }}
    >
      <p className="flex-1 text-sm">
        {needRefresh
          ? '新しいバージョンがあります'
          : 'オフラインで使えるようになりました'}
      </p>
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
  )
}
