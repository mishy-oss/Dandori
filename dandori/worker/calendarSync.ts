import type { Issue } from '../src/db/types'
import type { SyncData } from '../src/features/account/syncModel'
import { isSyncData, MAX_SYNC_BYTES, sameValue } from '../src/features/account/syncModel'
import { digest } from './accountSecurity'
import { rankAfter } from '../src/lib/rank'

export interface CalendarEvent {
  id: string
  etag: string
  status?: string
  summary?: string
  description?: string
  eventType?: string
  start?: { date?: string; dateTime?: string; timeZone?: string }
  end?: { date?: string; dateTime?: string; timeZone?: string }
  organizer?: { self?: boolean }
  attendees?: unknown[]
  recurringEventId?: string
  extendedProperties?: { private?: Record<string, string> }
}
export interface CalendarLink { eventId: string; etag: string; fingerprint: string; readOnly: boolean; removed?: boolean; seriesId?: string }
export interface CalendarState { id: string; name: string; timeZone: string; syncToken?: string; windowMonth?: string; links: Record<string, CalendarLink> }
export class GoogleApiError extends Error {
  status: number
  constructor(status: number) { super(status === 412 ? '同期中にGoogleの予定が変更されました。もう一度同期してください' : status === 401 || status === 403 ? 'カレンダーの権限を確認し、Googleと再連携してください' : `カレンダーAPIの処理に失敗しました（${status}）。少し待って再試行してください`); this.status = status }
}
export type GoogleRequest = (path: string, init?: RequestInit) => Promise<Response>
const DAY = 86_400_000

function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { date: `${values.year}-${values.month}-${values.day}`, minutes: Number(values.hour) * 60 + Number(values.minute) }
}
export function zonedInstant(date: string, minutes: number, timeZone: string): string {
  const target = Date.parse(`${date}T00:00:00Z`) + minutes * 60_000
  let candidate = target
  for (let index = 0; index < 3; index++) {
    const parts = localParts(new Date(candidate), timeZone)
    const rendered = Date.parse(`${parts.date}T00:00:00Z`) + parts.minutes * 60_000
    candidate += target - rendered
  }
  const result = localParts(new Date(candidate), timeZone)
  const normalized = new Date(target)
  if (result.date !== normalized.toISOString().slice(0, 10) || result.minutes !== normalized.getUTCHours() * 60 + normalized.getUTCMinutes()) throw new Error('夏時間の切替で存在しない時刻です。予定時刻を変更してください')
  return new Date(candidate).toISOString()
}

export function eventFields(event: CalendarEvent, timeZone: string) {
  if (event.eventType && event.eventType !== 'default') return null
  if (event.start?.date && event.end?.date) {
    if (Date.parse(event.end.date) - Date.parse(event.start.date) !== DAY) return null
    return { title: event.summary || '（無題の予定）', description: event.description || '', date: event.start.date, startMin: null, durationMin: 1440, calendarAllDay: true }
  }
  if (!event.start?.dateTime || !event.end?.dateTime) return null
  const start = new Date(event.start.dateTime), end = new Date(event.end.dateTime)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null
  const parts = localParts(start, timeZone), endParts = localParts(end, timeZone)
  const duration = (end.getTime() - start.getTime()) / 60_000
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440 || duration + parts.minutes > 1440 || (parts.date !== endParts.date && !(endParts.minutes === 0 && duration + parts.minutes === 1440))) return null
  return { title: event.summary || '（無題の予定）', description: event.description || '', date: parts.date, startMin: parts.minutes, durationMin: duration, calendarAllDay: false }
}
function fields(issue: Issue) {
  return { title: issue.title, description: issue.description || '', date: issue.date, startMin: issue.startMin, durationMin: issue.calendarAllDay ? 1440 : issue.durationMin, calendarAllDay: !!issue.calendarAllDay }
}
function fingerprint(issue: Issue): string { return JSON.stringify({ ...fields(issue), deleted: issue.deletedAt !== null }) }
function scheduled(issue: Issue): boolean { return issue.deletedAt === null && !!issue.date && (issue.startMin !== null || !!issue.calendarAllDay) }
export function eventBody(issue: Issue, timeZone: string) {
  if (!issue.date) throw new Error('日付がありません')
  const start = issue.calendarAllDay ? { date: issue.date } : { dateTime: zonedInstant(issue.date, issue.startMin!, timeZone), timeZone }
  const end = issue.calendarAllDay ? { date: new Date(Date.parse(issue.date) + DAY).toISOString().slice(0,10) } : { dateTime: zonedInstant(issue.date, issue.startMin! + issue.durationMin, timeZone), timeZone }
  return { summary: issue.title, description: issue.description || '', start, end }
}
async function json<T>(response: Response): Promise<T> {
  if (!response.ok) throw new GoogleApiError(response.status)
  return response.json<T>()
}

export async function synchronizeCalendar(input: SyncData, previous: CalendarState, request: GoogleRequest, now = Date.now()) {
  const data = structuredClone(input), calendar = structuredClone(previous)
  const path = `/calendars/${encodeURIComponent(calendar.id)}/events`
  const month = new Date(now).toISOString().slice(0,7)
  let syncToken = calendar.windowMonth === month ? calendar.syncToken : undefined
  async function list(token?: string) {
    const events: CalendarEvent[] = []
    let pageToken: string | undefined, nextSyncToken: string | undefined
    do {
      const query = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' })
      if (token) query.set('syncToken', token)
      else { query.set('timeMin', new Date(now - 366 * DAY).toISOString()); query.set('timeMax', new Date(now + 366 * DAY).toISOString()) }
      if (pageToken) query.set('pageToken', pageToken)
      const page = await json<{ items?: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string }>(await request(`${path}?${query}`))
      events.push(...page.items ?? [])
      if (events.length > 10_000) throw new Error('カレンダーの予定が多すぎます。連携専用のカレンダーを選択してください')
      pageToken = page.nextPageToken; nextSyncToken = page.nextSyncToken
    } while (pageToken)
    return { events, nextSyncToken }
  }
  let listing
  try { listing = await list(syncToken) }
  catch (error) {
    if (!(error instanceof GoogleApiError) || error.status !== 410 || !syncToken) throw error
    syncToken = undefined
    listing = await list()
  }
  const events = new Map(listing.events.map(event => [event.id, event]))
  if (!syncToken) {
    // 完全同期の一覧にない予定は、期間外へ移動した可能性と削除された可能性を区別する。
    for (const link of Object.values(calendar.links)) {
      if (link.removed || events.has(link.eventId)) continue
      const response = await request(`${path}/${encodeURIComponent(link.eventId)}`)
      const event = response.status === 404 || response.status === 410
        ? { id: link.eventId, etag: link.etag, status: 'cancelled' }
        : await json<CalendarEvent>(response)
      listing.events.push(event); events.set(event.id, event)
    }
  }
  for (const event of [...events.values()]) {
    if (event.status !== 'cancelled') continue
    for (const link of Object.values(calendar.links)) {
      if (link.seriesId === event.id) events.set(link.eventId, { id: link.eventId, etag: link.etag, status: 'cancelled' })
    }
  }
  listing.events = [...events.values()]
  const byEvent = new Map(Object.entries(calendar.links).map(([id, link]) => [link.eventId, id]))
  const pendingWrites: Array<{ issue: Issue; link?: CalendarLink; event?: CalendarEvent }> = []
  const conflicts: string[] = []
  let skipped = 0, imported = 0, exported = 0
  const source = await digest(calendar.id)
  let lastRank = data.issues.reduce<string | null>((last, issue) => last === null || issue.rank > last ? issue.rank : last, null)
  for (const event of listing.events) {
    let issue = data.issues.find(row => row.id === byEvent.get(event.id))
    // 途中で通信が切れても、Googleへ登録済みの予定を別タスクとして再取り込みしない。
    if (!issue && event.extendedProperties?.private?.dandoriIssueId) issue = data.issues.find(row => row.id === event.extendedProperties?.private?.dandoriIssueId)
    if (!issue) {
      const importedId = `g-${await digest(`${calendar.id}:${event.id}`)}`
      issue = data.issues.find(row => row.id === importedId)
    }
    // 持ち越し元の配置は履歴として固定し、Google側の後日の変更でも上書きしない。
    if (issue?.carryoverToId) continue
    const link = issue ? calendar.links[issue.id] : undefined
    if (link?.removed) continue
    if (event.status === 'cancelled') {
      if (issue) {
        if (link && !scheduled(issue)) calendar.links[issue.id] = { ...link, fingerprint: fingerprint(issue), removed: true }
        else if (link && fingerprint(issue) !== link.fingerprint && issue.deletedAt === null) conflicts.push(issue.title)
        else { issue.deletedAt = issue.deletedAt ?? now; issue.updatedAt = now; delete calendar.links[issue.id] }
      }
      continue
    }
    const value = eventFields(event, calendar.timeZone)
    if (!value) { skipped++; continue }
    if (issue && !link && (!sameValue(fields(issue), value) || issue.deletedAt !== null)) { conflicts.push(issue.title); continue }
    const readOnly = event.organizer?.self === false || (event.attendees?.length ?? 0) > 0
    if (issue && link && fingerprint(issue) !== link.fingerprint && event.etag !== link.etag && !sameValue(fields(issue), value)) { conflicts.push(issue.title); continue }
    if (!issue) {
      const id = `g-${await digest(`${calendar.id}:${event.id}`)}`
      if (data.issues.some(row => row.id === id && row.deletedAt !== null)) continue
      const project = data.projects[0]
      lastRank = rankAfter(lastRank)
      issue = { id, projectId: project.id, number: project.nextNumber++, type: 'task', statusId: 'account-routine', isRoutine: true, priority: 'medium', parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: value.date.slice(0,7), rank: lastRank, icon: '', color: '#38bdf8', reminderOffsetMin: 0, recurrenceId: null, assigneeId: null, completedAt: null, createdAt: now, updatedAt: now, deletedAt: null, ...value }
      data.issues.push(issue); imported++
    } else if (!link || fingerprint(issue) === link.fingerprint || sameValue(fields(issue), value)) {
      if (!sameValue(fields(issue), value)) { Object.assign(issue, value, { planningMonth: value.date.slice(0,7), updatedAt: now }); imported++ }
    }
    issue.calendarSource = source; issue.calendarReadOnly = readOnly
    if (event.recurringEventId) issue.calendarSeriesId = await digest(`${calendar.id}:${event.recurringEventId}`)
    if (!link || fingerprint(issue) === link.fingerprint || sameValue(fields(issue), value)) calendar.links[issue.id] = { eventId: event.id, etag: event.etag, fingerprint: fingerprint(issue), readOnly, seriesId: event.recurringEventId }
  }
  for (const issue of data.issues) {
    if (issue.carryoverToId) continue
    if (issue.calendarSource && issue.calendarSource !== source) continue
    const savedLink = calendar.links[issue.id]
    const link = savedLink?.removed ? undefined : savedLink
    if (savedLink?.removed && !scheduled(issue)) continue
    if (link && fingerprint(issue) === link.fingerprint) continue
    if (link?.readOnly) { skipped++; continue }
    if (!link && !scheduled(issue)) continue
    let event = link ? events.get(link.eventId) : undefined
    if (link && !event) {
      const response = await request(`${path}/${encodeURIComponent(link.eventId)}`)
      if (response.status === 404 || response.status === 410) {
        if (issue.deletedAt === null && fingerprint(issue) !== link.fingerprint) { conflicts.push(issue.title); continue }
        issue.deletedAt = issue.deletedAt ?? now; issue.updatedAt = now; delete calendar.links[issue.id]; continue
      }
      event = await json<CalendarEvent>(response)
    }
    if (event && link && event.etag !== link.etag && event.status !== 'cancelled' && !sameValue(fields(issue), eventFields(event, calendar.timeZone))) { conflicts.push(issue.title); continue }
    pendingWrites.push({ issue, link, event })
  }
  if (conflicts.length) throw new Error(`両方で変更された予定があります：${[...new Set(conflicts)].slice(0,5).join('、')}。アプリとGoogleの内容を揃えてから再同期してください`)
  if (!isSyncData(data) || new TextEncoder().encode(JSON.stringify(data)).length > MAX_SYNC_BYTES) throw new Error('同期後のデータが上限を超えています。連携するカレンダーを見直してください')
  // 競合の検査を終えてからGoogleを書き換え、ETagで検査後の変更も検出する。
  let more = false
  for (const { issue, link, event } of pendingWrites) {
    if (exported >= 100) { more = true; break }
    if (link && !scheduled(issue)) {
      if (event?.status !== 'cancelled') {
        const response = await request(`${path}/${encodeURIComponent(link.eventId)}?sendUpdates=none`, { method: 'DELETE', headers: { 'If-Match': event?.etag ?? link.etag } })
        if (!response.ok && response.status !== 404 && response.status !== 410) throw new GoogleApiError(response.status)
      }
      calendar.links[issue.id] = { ...link, fingerprint: fingerprint(issue), removed: true }; exported++; continue
    }
    const body: Record<string, unknown> = eventBody(issue, calendar.timeZone)
    const existingFields = event && eventFields(event, calendar.timeZone)
    // タイトルだけの編集で、Google側の秒・タイムゾーン表現まで書き換えない。
    if (link && existingFields && existingFields.date === issue.date && existingFields.startMin === issue.startMin && existingFields.durationMin === issue.durationMin && existingFields.calendarAllDay === !!issue.calendarAllDay) { delete body.start; delete body.end }
    let saved: CalendarEvent
    if (link) saved = await json<CalendarEvent>(await request(`${path}/${encodeURIComponent(link.eventId)}?sendUpdates=none`, { method: 'PATCH', headers: { 'If-Match': event?.etag ?? link.etag }, body: JSON.stringify(body) }))
    else {
      const prior = calendar.links[issue.id]
      const key = prior?.removed ? `${issue.id}:${prior.eventId}` : issue.id
      const id = `d${[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(byte => byte.toString(16).padStart(2,'0')).join('')}`
      const response = await request(`${path}?sendUpdates=none`, { method: 'POST', body: JSON.stringify({ ...body, id, extendedProperties: { private: { dandoriIssueId: issue.id } } }) })
      if (response.status === 409) {
        saved = await json<CalendarEvent>(await request(`${path}/${id}`))
        if (saved.extendedProperties?.private?.dandoriIssueId !== issue.id || !sameValue(eventFields(saved, calendar.timeZone), fields(issue))) throw new Error('Googleへの登録後に内容が変わりました。もう一度同期してください')
      } else saved = await json<CalendarEvent>(response)
    }
    issue.calendarSource = source
    calendar.links[issue.id] = { eventId: saved.id, etag: saved.etag, fingerprint: fingerprint(issue), readOnly: false, seriesId: saved.recurringEventId ?? link?.seriesId }
    exported++
  }
  calendar.syncToken = listing.nextSyncToken; calendar.windowMonth = month
  return { data, calendar, imported, exported, skipped, more }
}
