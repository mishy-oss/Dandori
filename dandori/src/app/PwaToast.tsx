import { useRegisterSW } from 'virtual:pwa-register/react'

/** Service Workerの更新待ちとオフライン利用の準備完了を通知し、更新・閉じる操作を受け付ける。 */
export function PwaToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh && !offlineReady) return null

  /** 更新案内とオフライン利用案内の両方を非表示にする。 */
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
          onClick={/* 待機中のService Workerを有効化して、アプリを新しいバージョンへ更新する。 */ () => updateServiceWorker(true)}
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
