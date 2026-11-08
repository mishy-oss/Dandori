import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('message', /* 更新要求のメッセージを受けたら、待機中のService Workerをすぐ有効化する。 */ (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('push', /* 届いたPushデータからタイトルと本文を取り出し、不足値を補ってOSの通知として表示する。 */ (event) => {
  let payload = {}
  try {
    payload = event.data?.json() ?? {}
  } catch {
    payload = {}
  }

  const title = typeof payload.title === 'string' ? payload.title : 'Dandori'
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '予定の時刻です',
    icon: '/pwa-192x192.png',
    badge: '/pwa-64x64.png',
    data: { url: typeof payload.url === 'string' ? payload.url : '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', /* クリックされた通知を閉じ、同じアプリの既存画面を前面へ出すか、新しい画面を開く。 */ (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin)
  const url = target.origin === self.location.origin ? target.href : self.location.origin

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(/* 既存のアプリ画面を探して前面へ出し、なければ同じオリジン内の画面を新しく開く。 */ (clients) => {
      const existing = clients.find(/* 同じオリジンで開いているアプリ画面を探し、通知クリック時に再利用できるようにする。 */ (client) => client.url.startsWith(self.location.origin))
      if (existing) return existing.focus()
      return self.clients.openWindow(url)
    }),
  )
})
