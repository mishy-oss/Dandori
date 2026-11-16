import { useState } from 'react'
import { FIELD_CLASS } from '../../app/fields'
import { useDataStore } from '../../store/data'

const START_HOURS = Array.from({ length: 24 }, (_, i) => i)
const END_HOURS = Array.from({ length: 24 }, (_, i) => i + 1)

export function TimelineSettingsSection() {
  const settings = useDataStore((s) => s.settings)
  const updateSettings = useDataStore((s) => s.updateSettings)
  const [error, setError] = useState<string | null>(null)

  async function save(patch: Parameters<typeof updateSettings>[0]) {
    try {
      setError(null)
      await updateSettings(patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted">タイムライン</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-muted">
          開始時刻
          <select
            className={FIELD_CLASS}
            value={settings.dayStartHour}
            onChange={(e) => void save({ dayStartHour: Number(e.target.value) })}
          >
            {START_HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          終了時刻
          <select
            className={FIELD_CLASS}
            value={settings.dayEndHour}
            onChange={(e) => void save({ dayEndHour: Number(e.target.value) })}
          >
            {END_HOURS.map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, '0')}:00
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          既定の所要時間(分)
          <input
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            className={FIELD_CLASS}
            defaultValue={settings.defaultDuration}
            key={settings.defaultDuration}
            onBlur={(e) => void save({ defaultDuration: Number(e.target.value) })}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-muted">
          週の開始
          <select
            className={FIELD_CLASS}
            value={settings.weekStartsOn}
            onChange={(e) => void save({ weekStartsOn: Number(e.target.value) as 0 | 1 })}
          >
            <option value={1}>月曜</option>
            <option value={0}>日曜</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-500">
          {error}
        </p>
      )}
    </div>
  )
}
