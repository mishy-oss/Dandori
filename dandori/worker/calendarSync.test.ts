import { expect, it, vi } from 'vitest'
import { eventBody, eventFields, synchronizeCalendar, zonedInstant, type CalendarEvent, type CalendarState } from './calendarSync'
import { initialSyncData } from '../src/features/account/syncModel'
import { fixtureIssue } from '../src/features/account/syncFixtures'
import { groupBoardIssues } from '../src/features/board/recurringGroups'
import { rankAfter } from '../src/lib/rank'

const now = Date.parse('2026-11-17T00:00:00Z')
const calendar = (): CalendarState => ({ id: 'my-calendar', name: '予定', timeZone: 'Asia/Tokyo', links: {} })
const event = (patch: Partial<CalendarEvent> = {}): CalendarEvent => ({ id: 'event-1', etag: 'etag-1', status: 'confirmed', summary: '会議', start: { dateTime: '2026-11-17T00:00:00Z' }, end: { dateTime: '2026-11-17T01:00:00Z' }, ...patch })
function google(items: CalendarEvent[]) {
  const request = vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    if (!init?.method) return Response.json({ items, nextSyncToken: 'next-token' })
    if (init.method === 'DELETE') return new Response(null, { status: 204 })
    const body = JSON.parse(String(init.body)) as CalendarEvent
    return Response.json({ ...body, id: body.id || path.split('/').at(-1)?.split('?')[0], etag: 'saved-etag' })
  })
  return request
}

it('converts time zones and rejects nonexistent DST times rather than silently moving meetings', () => {
  expect(zonedInstant('2026-11-17', 540, 'Asia/Tokyo')).toBe('2026-11-17T00:00:00.000Z')
  expect(zonedInstant('2026-07-01', 540, 'America/New_York')).toBe('2026-07-01T13:00:00.000Z')
  expect(() => zonedInstant('2026-03-08', 150, 'America/New_York')).toThrow('存在しない時刻')
  expect(eventFields(event(), 'Asia/Tokyo')).toMatchObject({ date: '2026-11-17', startMin: 540, durationMin: 60 })
})
it('round trips one-day all-day events and excludes multi-day or special events', () => {
  const value = eventFields(event({ start: { date: '2026-11-17' }, end: { date: '2026-11-18' } }), 'Asia/Tokyo')
  expect(value).toMatchObject({ calendarAllDay: true, startMin: null, durationMin: 1440 })
  expect(eventBody(fixtureIssue({ ...value!, calendarAllDay: true }), 'Asia/Tokyo')).toMatchObject({ start: { date: '2026-11-17' }, end: { date: '2026-11-18' } })
  expect(eventFields(event({ start: { date: '2026-11-17' }, end: { date: '2026-11-19' } }), 'Asia/Tokyo')).toBeNull()
  expect(eventFields(event({ eventType: 'birthday' }), 'Asia/Tokyo')).toBeNull()
})
it('imports a Google event once into Recurring and does not export it again', async () => {
  const request = google([event()])
  const first = await synchronizeCalendar(initialSyncData(1), calendar(), request, now)
  expect(first.data.issues).toHaveLength(1)
  expect(first.data.issues[0]).toMatchObject({ title: '会議', statusId: 'account-routine', startMin: 540, isRoutine: true })
  const second = await synchronizeCalendar(first.data, first.calendar, request, now)
  expect(second.data.issues).toHaveLength(1)
  expect(second.exported).toBe(0)
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})
it('recovers an existing imported task if link metadata is missing and stops rather than overwriting a differing task', async () => {
  const first = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  const recovered = await synchronizeCalendar(first.data, calendar(), google([event()]), now)
  expect(recovered.data.issues).toHaveLength(1)
  expect(Object.keys(recovered.calendar.links)).toHaveLength(1)
  first.data.issues[0].title = '同期情報がない間の編集'
  await expect(synchronizeCalendar(first.data, calendar(), google([event()]), now)).rejects.toThrow('両方で変更')
})
it('uses deterministic event IDs to recover an interrupted insert without duplicates', async () => {
  const data = initialSyncData(1); data.issues = [fixtureIssue()]; data.projects[0].nextNumber = 2
  const request = google([])
  const first = await synchronizeCalendar(data, calendar(), request, now)
  const created = request.mock.calls.find(([, init]) => init?.method === 'POST')!
  const body = JSON.parse(String(created[1]?.body)) as CalendarEvent
  expect(body.id).toMatch(/^d[a-f0-9]{64}$/)
  const retry = vi.fn(async (_path: string, init?: RequestInit) => init?.method === 'POST' ? new Response(null, { status: 409 }) : Response.json(init ? {} : _path.includes('?') ? { items: [], nextSyncToken: 't' } : { ...body, etag: 'saved' }))
  const result = await synchronizeCalendar(data, calendar(), retry, now)
  expect(result.exported).toBe(1)
  expect(result.calendar.links['task-1'].eventId).toBe(body.id)
  expect(first.data.issues).toHaveLength(1)
})
it('updates only changed fields with If-Match and leaves attendees out of outgoing requests', async () => {
  const initial = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  initial.data.issues[0].title = '変更後'
  const request = google([event()])
  await synchronizeCalendar(initial.data, initial.calendar, request, now)
  const write = request.mock.calls.find(([, init]) => init?.method === 'PATCH')!
  expect(write[1]?.headers).toEqual({ 'If-Match': 'etag-1' })
  expect(JSON.parse(String(write[1]?.body))).not.toHaveProperty('attendees')
  expect(JSON.parse(String(write[1]?.body))).not.toHaveProperty('start')
  expect(write[0]).toContain('sendUpdates=none')
})
it('stops before writing when both sides edit an event', async () => {
  const initial = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  initial.data.issues[0].title = '端末変更'
  const request = google([event({ etag: 'new-etag', summary: 'Google変更' })])
  await expect(synchronizeCalendar(initial.data, initial.calendar, request, now)).rejects.toThrow('両方で変更')
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})
it('imports invited meetings but never writes or deletes them', async () => {
  const meeting = event({ attendees: [{ email: 'guest@example.com' }] })
  const initial = await synchronizeCalendar(initialSyncData(1), calendar(), google([meeting]), now)
  initial.data.issues[0].title = '端末内だけのメモ'
  const request = google([meeting])
  const result = await synchronizeCalendar(initial.data, initial.calendar, request, now)
  expect(result.skipped).toBe(1)
  expect(result.data.issues[0].calendarReadOnly).toBe(true)
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})
it('soft deletes a task when its Google event is cancelled', async () => {
  const initial = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  const result = await synchronizeCalendar(initial.data, initial.calendar, google([event({ status: 'cancelled' })]), now)
  expect(result.data.issues[0].deletedAt).toBe(now)
})
it('removes an unplaced event without deleting the task and can place it again with a new Google ID', async () => {
  const data = initialSyncData(1); data.issues = [fixtureIssue()]; data.projects[0].nextNumber = 2
  const insert = google([])
  const first = await synchronizeCalendar(data, calendar(), insert, now)
  const firstEvent = { ...JSON.parse(String(insert.mock.calls.find(([, init]) => init?.method === 'POST')![1]?.body)), etag: 'saved-etag' } as CalendarEvent
  first.data.issues[0].startMin = null
  const remove = google([firstEvent])
  const second = await synchronizeCalendar(first.data, first.calendar, remove, now)
  expect(remove.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(true)
  const third = await synchronizeCalendar(second.data, second.calendar, google([{ ...firstEvent, status: 'cancelled' }]), now)
  expect(third.data.issues[0].deletedAt).toBeNull()
  third.data.issues[0].startMin = 720
  const replace = google([{ ...firstEvent, status: 'cancelled' }])
  const fourth = await synchronizeCalendar(third.data, third.calendar, replace, now)
  expect(fourth.calendar.links['task-1'].eventId).not.toBe(firstEvent.id)
})
it('restarts a full sync on 410, handles pagination, and reconciles missing events', async () => {
  const initial = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  const request = vi.fn(async (path: string) => {
    if (path.includes('syncToken=')) return new Response(null, { status: 410 })
    if (path.includes('singleEvents=') && !path.includes('pageToken=')) return Response.json({ items: [], nextPageToken: 'page2' })
    if (path.includes('pageToken=')) return Response.json({ items: [], nextSyncToken: 'fresh' })
    return new Response(null, { status: 404 })
  })
  const result = await synchronizeCalendar(initial.data, initial.calendar, request, now)
  expect(result.calendar.syncToken).toBe('fresh')
  expect(result.data.issues[0].deletedAt).toBe(now)
  expect(request.mock.calls).toHaveLength(4)
})
it('groups imported recurring instances without generating a second recurrence rule and handles series cancellation', async () => {
  const events = [event({ recurringEventId: 'series' }), event({ id: 'event-2', recurringEventId: 'series' })]
  const first = await synchronizeCalendar(initialSyncData(1), calendar(), google(events), now)
  expect(groupBoardIssues(first.data.issues, new Set())).toHaveLength(1)
  expect(first.data.recurrenceRules).toHaveLength(0)
  expect(() => rankAfter(first.data.issues.at(-1)!.rank)).not.toThrow()
  const second = await synchronizeCalendar(first.data, first.calendar, google([event({ id: 'series', status: 'cancelled' })]), now)
  expect(second.data.issues.every(issue => issue.deletedAt === now)).toBe(true)
})
it('recovers an interrupted unplacement delete without deleting the unscheduled task', async () => {
  const first = await synchronizeCalendar(initialSyncData(1), calendar(), google([event()]), now)
  first.data.issues[0].startMin = null
  const request = google([event({ status: 'cancelled' })])
  const second = await synchronizeCalendar(first.data, first.calendar, request, now)
  expect(second.data.issues[0].deletedAt).toBeNull()
  expect(second.calendar.links[first.data.issues[0].id].removed).toBe(true)
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})
