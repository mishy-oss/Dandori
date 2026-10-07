import { db } from './db'
import { DEFAULT_SETTINGS, type Settings } from './types'

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main')
  return { ...DEFAULT_SETTINGS, ...row }
}

export async function updateSettings(patch: Partial<Omit<Settings, 'id'>>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch }
  const { dayStartHour: s, dayEndHour: e, defaultDuration: d } = next
  if (!Number.isInteger(s) || s < 0 || s > 23) throw new Error('開始時刻は0〜23時で指定してください')
  if (!Number.isInteger(e) || e < 1 || e > 24) throw new Error('終了時刻は1〜24時で指定してください')
  if (e - s < 1) throw new Error('終了時刻は開始時刻より後にしてください')
  if (!Number.isInteger(d) || d < 5 || d > 480) throw new Error('既定の所要時間は5〜480分で指定してください')
  if (next.weekStartsOn !== 0 && next.weekStartsOn !== 1) throw new Error('週の開始日が正しくありません')
  await db.settings.put(next)
  return next
}
