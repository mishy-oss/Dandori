import { useEffect, useState } from 'react'
import {
  clearPushSubscription,
  decodeVapidPublicKey,
  forgetPushDeviceToken,
  getOrCreatePushDeviceToken,
  notifyPushSettingsChanged,
  savePushSubscription,
  sendPushTest,
} from './pushClient'

const FIELD = 'min-h-11 w-full rounded-lg border border-border bg-surface-2 px-3 text-base'

/** 安全な接続で、通知・Service Worker・Push APIが利用可能かを判定する。 */
function isPushSupported(): boolean {
  return (
    window.isSecureContext &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  )
}

/** iPhoneやiPadでホーム画面から起動していない場合を検出し、通知許可の前にインストール案内が必要かを返す。 */
function needsHomeScreenInstall(): boolean {
  const isAppleMobile =
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  return isAppleMobile && !isStandalone
}

/** 通知サーバーの準備状況とブラウザーの許可状態を表示し、購読登録・停止・テスト通知を操作できるようにする。 */
export function PushNotificationsSettings() {
  const [supported, setSupported] = useState(false)
  const [serverReady, setServerReady] = useState(false)
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(/* 設定画面の表示時に通知の対応状況・公開鍵・既存購読を確認し、画面が閉じた後の不要な更新を防ぐ。 */ () => {
    let cancelled = false
    /** Push対応と通知許可を確認し、サーバーから公開鍵を取得する。既存の購読と端末トークンから有効状態を判定する。 */
    async function load() {
      const canPush = isPushSupported()
      if (cancelled) return
      setSupported(canPush)
      if (!canPush) {
        setPermission('unsupported')
        return
      }

      setPermission(Notification.permission)
      try {
        const response = await fetch('/api/push/config', { cache: 'no-store' })
        if (!response.ok) throw new Error('Push server is not configured')
        const config = (await response.json()) as { enabled?: boolean; publicKey?: string }
        if (!config.enabled || !config.publicKey) throw new Error('Push server is not configured')
        if (cancelled) return
        setPublicKey(config.publicKey)
        setServerReady(true)

        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()
        setEnabled(Boolean(subscription && localStorage.getItem('dandori.push.device-token') && Notification.permission === 'granted'))
      } catch {
        if (!cancelled) setServerReady(false)
      }
    }
    void load()
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => {
      cancelled = true
    }
  }, [])

  /** ボタン操作を起点に通知許可を求め、Push購読をサーバーへ登録する。成功後に通知予定の同期を促す。 */
  async function enablePush() {
    setError(null)
    setMessage(null)
    if (!supported) {
      setError('このブラウザーではWeb Pushを利用できません。')
      return
    }
    if (!serverReady || !publicKey) {
      setError('Pushサーバーの設定がまだ完了していません。')
      return
    }
    if (needsHomeScreenInstall()) {
      setError('iPhone/iPadでは、Safariの共有メニューからホーム画面に追加して、追加したアプリを開いてください。')
      return
    }

    setBusy(true)
    try {
      const nextPermission =
        Notification.permission === 'granted'
          ? 'granted'
          : await Notification.requestPermission()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') {
        setError(nextPermission === 'denied' ? '通知がブロックされています。ブラウザーのサイト設定で許可してください。' : '通知の許可が必要です。')
        return
      }

      const registration = await navigator.serviceWorker.ready
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey),
        }))
      const deviceToken = getOrCreatePushDeviceToken()
      await savePushSubscription(deviceToken, subscription)
      setEnabled(true)
      setMessage('PWA通知を有効にしました。通知時刻を設定したIssueを登録すると通知します。')
      notifyPushSettingsChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /** サーバーの購読と予定を削除し、ブラウザーの購読解除と端末トークンの削除を行う。 */
  async function disablePush() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const deviceToken = localStorage.getItem('dandori.push.device-token')
      if (deviceToken) await clearPushSubscription(deviceToken)
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      await subscription?.unsubscribe()
      forgetPushDeviceToken()
      setEnabled(false)
      setMessage('PWA通知を停止しました。')
      notifyPushSettingsChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  /** この端末へのテスト通知をサーバーに依頼し、送信結果や失敗理由を設定画面に表示する。 */
  async function sendTest() {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const deviceToken = localStorage.getItem('dandori.push.device-token')
      if (!deviceToken) throw new Error('この端末の通知登録が見つかりません。')
      await sendPushTest(deviceToken)
      setMessage('テスト通知を送信しました。届くまで少し時間がかかる場合があります。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold text-muted">PWA通知</h2>
      <p className="mb-3 text-sm text-muted">
        PWAを閉じている間も、開始時刻を設定したIssueを通知します。Issueごとに通知時刻を設定できます。
      </p>
      {!supported && <p className="mb-3 text-sm text-muted">このブラウザーまたは接続ではWeb Pushに対応していません。</p>}
      {supported && !serverReady && (
        <p className="mb-3 text-sm text-muted">通知サーバーのVAPIDキー設定とデプロイが必要です。</p>
      )}
      {permission === 'denied' && (
        <p className="mb-3 text-sm text-muted">通知がブラウザーでブロックされています。サイト設定から許可してください。</p>
      )}
      {needsHomeScreenInstall() && (
        <p className="mb-3 text-sm text-muted">iPhone/iPadではホーム画面に追加したPWAからのみ許可できます。</p>
      )}
      <div className="flex flex-wrap gap-2">
        {enabled ? (
          <>
            <button type="button" disabled={busy} onClick={/* この端末へのテスト通知の送信を開始する。 */ () => void sendTest()} className={FIELD}>
              テスト通知を送る
            </button>
            <button type="button" disabled={busy} onClick={/* この端末のPush購読と通知予定を解除する。 */ () => void disablePush()} className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40">
              通知を停止
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={busy || !supported || !serverReady || permission === 'denied'}
            onClick={/* 通知許可の確認と、この端末のPush購読登録を開始する。 */ () => void enablePush()}
            className="min-h-11 rounded-lg bg-accent px-4 text-sm font-semibold text-accent-text disabled:opacity-40"
          >
            {busy ? '設定中…' : 'PWA通知を有効にする'}
          </button>
        )}
      </div>
      {message && <p role="status" className="mt-3 text-sm text-accent">{message}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-400">{error}</p>}
    </section>
  )
}
