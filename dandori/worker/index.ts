import { DurableObject } from 'cloudflare:workers'
import {
  buildPushPayload,
  type PushSubscription,
  type VapidKeys,
} from '@block65/webcrypto-web-push'

const MAX_SCHEDULES = 500
const MAX_SCHEDULE_AHEAD_MS = 366 * 24 * 60 * 60 * 1000
const MAX_RETRIES = 5
const MAX_PUSH_DELAY_MS = 6 * 60 * 60 * 1000

type ScheduleInput = { id: string; at: number; title: string }
type SubscriptionRow = { endpoint: string; p256dh: string; auth: string }
type JobRow = { id: string; scheduled_at: number; title: string; attempts: number; retry_at: number }

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

function isAllowedPushEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase()
    const supportedHost =
      host === 'fcm.googleapis.com' ||
      host === 'updates.push.services.mozilla.com' ||
      host.endsWith('.push.services.mozilla.com') ||
      host === 'web.push.apple.com' ||
      host.endsWith('.push.apple.com') ||
      host.endsWith('.notify.windows.com')
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && supportedHost
  } catch {
    return false
  }
}

function isPushSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== 'object') return false
  const subscription = value as Partial<PushSubscription>
  return (
    typeof subscription.endpoint === 'string' &&
    isAllowedPushEndpoint(subscription.endpoint) &&
    !!subscription.keys &&
    typeof subscription.keys.p256dh === 'string' &&
    typeof subscription.keys.auth === 'string'
  )
}

export class PushDevice extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscription (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL
      )
    `)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS notification_job (
        id TEXT PRIMARY KEY,
        scheduled_at INTEGER NOT NULL,
        title TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL
      )
    `)
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

    if (path === '/subscribe') return this.subscribe(request)
    if (path === '/schedules') return this.replaceSchedules(request)
    if (path === '/unsubscribe') return this.unsubscribe()
    if (path === '/test') return this.sendTestNotification()
    return json({ error: 'Not found' }, 404)
  }

  private async readJson(request: Request): Promise<unknown> {
    const size = Number(request.headers.get('content-length') ?? 0)
    if (size > 256_000) throw new Error('Request is too large')
    return request.json()
  }

  private async subscribe(request: Request): Promise<Response> {
    try {
      const body = await this.readJson(request)
      if (!body || typeof body !== 'object' || !('subscription' in body)) {
        return json({ error: 'Invalid subscription' }, 400)
      }
      const subscription = body.subscription
      if (!isPushSubscription(subscription)) return json({ error: 'Invalid subscription endpoint or keys' }, 400)

      this.ctx.storage.sql.exec(
        `INSERT INTO subscription (id, endpoint, p256dh, auth) VALUES (1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET endpoint = excluded.endpoint, p256dh = excluded.p256dh, auth = excluded.auth`,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
      )
      return json({ ok: true })
    } catch (error) {
      console.error(JSON.stringify({ message: 'push_subscription_save_failed', error: error instanceof Error ? error.message : String(error) }))
      return json({ error: 'Invalid request' }, 400)
    }
  }

  private async replaceSchedules(request: Request): Promise<Response> {
    try {
      const body = await this.readJson(request)
      const notifications =
        body && typeof body === 'object' && 'notifications' in body
          ? body.notifications
          : undefined
      if (!Array.isArray(notifications) || notifications.length > MAX_SCHEDULES) {
        return json({ error: `Send no more than ${MAX_SCHEDULES} notifications` }, 400)
      }
      const subscription = this.ctx.storage.sql.exec<SubscriptionRow>(
        'SELECT endpoint, p256dh, auth FROM subscription WHERE id = 1',
      ).toArray()[0]
      if (!subscription) return json({ error: 'Push is not enabled on this device' }, 409)

      const now = Date.now()
      const valid: ScheduleInput[] = []
      for (const item of notifications) {
        if (!item || typeof item !== 'object') return json({ error: 'Invalid notification schedule' }, 400)
        const candidate = item as Partial<ScheduleInput>
        if (
          typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 128 ||
          typeof candidate.at !== 'number' || !Number.isFinite(candidate.at) ||
          candidate.at < now - 60_000 || candidate.at > now + MAX_SCHEDULE_AHEAD_MS ||
          typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 120
        ) {
          return json({ error: 'Invalid notification schedule' }, 400)
        }
        if (candidate.at > now) valid.push({ id: candidate.id, at: Math.floor(candidate.at), title: candidate.title.trim() })
      }

      this.ctx.storage.sql.exec('DELETE FROM notification_job')
      for (const item of valid) {
        this.ctx.storage.sql.exec(
          'INSERT OR REPLACE INTO notification_job (id, scheduled_at, title, attempts, retry_at) VALUES (?, ?, ?, 0, ?)',
          item.id,
          item.at,
          item.title,
          item.at,
        )
      }
      await this.scheduleNextAlarm()
      return json({ ok: true, scheduled: valid.length })
    } catch (error) {
      console.error(JSON.stringify({ message: 'push_schedule_update_failed', error: error instanceof Error ? error.message : String(error) }))
      return json({ error: 'Invalid request' }, 400)
    }
  }

  private async unsubscribe(): Promise<Response> {
    this.ctx.storage.sql.exec('DELETE FROM notification_job')
    this.ctx.storage.sql.exec('DELETE FROM subscription')
    await this.ctx.storage.deleteAlarm()
    return json({ ok: true })
  }

  private async sendTestNotification(): Promise<Response> {
    const result = await this.send('Dandoriの通知テストです')
    return result.ok ? json({ ok: true }) : json({ error: result.message }, result.status)
  }

  async alarm(): Promise<void> {
    const subscriptionRow = this.ctx.storage.sql.exec<SubscriptionRow>(
      'SELECT endpoint, p256dh, auth FROM subscription WHERE id = 1',
    ).toArray()[0]
    if (!subscriptionRow) {
      this.ctx.storage.sql.exec('DELETE FROM notification_job')
      return
    }

    const due = this.ctx.storage.sql.exec<JobRow>(
      'SELECT id, scheduled_at, title, attempts, retry_at FROM notification_job WHERE retry_at <= ? ORDER BY retry_at LIMIT 50',
      Date.now(),
    ).toArray()

    for (const job of due) {
      if (Date.now() - job.scheduled_at > MAX_PUSH_DELAY_MS) {
        this.ctx.storage.sql.exec('DELETE FROM notification_job WHERE id = ?', job.id)
        continue
      }

      const result = await this.send(job.title)
      if (result.ok) {
        this.ctx.storage.sql.exec('DELETE FROM notification_job WHERE id = ?', job.id)
        continue
      }
      if (result.status === 404 || result.status === 410) {
        this.ctx.storage.sql.exec('DELETE FROM subscription')
        this.ctx.storage.sql.exec('DELETE FROM notification_job')
        await this.ctx.storage.deleteAlarm()
        return
      }
      if (job.attempts + 1 >= MAX_RETRIES) {
        this.ctx.storage.sql.exec('DELETE FROM notification_job WHERE id = ?', job.id)
        continue
      }

      const attempts = job.attempts + 1
      const retryAt = Date.now() + Math.min(2 ** attempts * 60_000, 60 * 60_000)
      this.ctx.storage.sql.exec(
        'UPDATE notification_job SET attempts = ?, retry_at = ? WHERE id = ?',
        attempts,
        retryAt,
        job.id,
      )
    }
    await this.scheduleNextAlarm()
  }

  private async send(message: string): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
    const subscriptionRow = this.ctx.storage.sql.exec<SubscriptionRow>(
      'SELECT endpoint, p256dh, auth FROM subscription WHERE id = 1',
    ).toArray()[0]
    if (!subscriptionRow) return { ok: false, status: 409, message: 'Push is not enabled' }
    if (!this.env.VAPID_PUBLIC_KEY || !this.env.VAPID_PRIVATE_KEY || !this.env.VAPID_SUBJECT) {
      return { ok: false, status: 503, message: 'Push server keys are not configured' }
    }

    try {
      const subscription: PushSubscription = {
        endpoint: subscriptionRow.endpoint,
        expirationTime: null,
        keys: { p256dh: subscriptionRow.p256dh, auth: subscriptionRow.auth },
      }
      const vapid: VapidKeys = {
        subject: this.env.VAPID_SUBJECT,
        publicKey: this.env.VAPID_PUBLIC_KEY,
        privateKey: this.env.VAPID_PRIVATE_KEY,
      }
      const payload = await buildPushPayload(
        { data: JSON.stringify({ title: 'Dandori', body: message, url: '/' }), options: { ttl: 3600, urgency: 'normal' } },
        subscription,
        vapid,
      )
      const response = await fetch(subscription.endpoint, payload)
      if (response.ok) return { ok: true }
      return { ok: false, status: response.status, message: 'Push service rejected the notification' }
    } catch (error) {
      console.error(JSON.stringify({ message: 'push_delivery_failed', error: error instanceof Error ? error.message : String(error) }))
      return { ok: false, status: 503, message: 'Push delivery failed' }
    }
  }

  private async scheduleNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql.exec<{ next_at: number | null }>(
      'SELECT MIN(retry_at) AS next_at FROM notification_job',
    ).toArray()[0]?.next_at
    if (next === null || next === undefined) {
      await this.ctx.storage.deleteAlarm()
      return
    }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, next))
  }
}

function isDeviceToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
}

async function readJson(request: Request): Promise<unknown> {
  const size = Number(request.headers.get('content-length') ?? 0)
  if (size > 256_000) throw new Error('Request is too large')
  return request.json()
}

async function sendToDevice(request: Request, env: Env, path: string): Promise<Response> {
  try {
    const body = await readJson(request)
    if (!body || typeof body !== 'object' || !('deviceToken' in body) || !isDeviceToken(body.deviceToken)) {
      return json({ error: 'Invalid device token' }, 400)
    }
    const token = body.deviceToken
    const device = env.PUSH_DEVICES.get(env.PUSH_DEVICES.idFromName(token))
    return device.fetch(new Request(`https://push-device${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }))
  } catch (error) {
    console.error(JSON.stringify({ message: 'push_api_request_failed', path, error: error instanceof Error ? error.message : String(error) }))
    return json({ error: 'Invalid request' }, 400)
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/push/')) return new Response(null, { status: 404 })

    if (request.method === 'GET' && url.pathname === '/api/push/config') {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
        return json({ enabled: false }, 503)
      }
      return json({ enabled: true, publicKey: env.VAPID_PUBLIC_KEY })
    }
    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') return sendToDevice(request, env, '/subscribe')
    if (request.method === 'POST' && url.pathname === '/api/push/schedules') return sendToDevice(request, env, '/schedules')
    if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') return sendToDevice(request, env, '/unsubscribe')
    if (request.method === 'POST' && url.pathname === '/api/push/test') return sendToDevice(request, env, '/test')
    return json({ error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>
