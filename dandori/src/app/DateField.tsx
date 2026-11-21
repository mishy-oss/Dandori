import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from './Icon'
import { displayInputDate, readInputDate } from './dateInput'

export function DateField({ label, value, onChange, className = '', required, disabled, min, max }: {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  required?: boolean
  disabled?: boolean
  min?: string
  max?: string
}) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<{ source: string; text: string } | null>(null)
  const editing = draft?.source === value ? draft : null
  const error = readInputDate(editing?.text ?? value, min, max).error

  useEffect(() => { inputRef.current?.setCustomValidity(error) }, [error])

  return <span className="relative block min-w-0">
    {/* 標準の日付欄の表示はOSの書式に左右されるため、表示とカレンダー選択を分ける。 */}
    <input ref={inputRef} type="text" inputMode="numeric" autoComplete="off" aria-label={label}
      aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined}
      required={required} disabled={disabled} placeholder="YYYY/MM/DD" className={`${className} pr-12`}
      value={editing?.text ?? displayInputDate(value)}
      onFocus={() => { if (!editing) setDraft({ source: value, text: value.replaceAll('-', '/') }) }}
      onChange={event => {
        const text = event.target.value
        const result = readInputDate(text, min, max)
        event.currentTarget.setCustomValidity(result.error)
        setDraft({ source: result.value ?? value, text })
        if (result.value !== null) onChange(result.value)
      }}
      onBlur={() => { if (!error) setDraft(null) }} />
    <span className="absolute right-0 top-0 flex size-11 items-center justify-center rounded-lg text-muted focus-within:ring-2 focus-within:ring-accent">
      <Icon name="calendar" className="pointer-events-none size-5" />
      <input type="date" aria-label={`${label}をカレンダーから選択`} className="date-picker-native absolute inset-0 size-full cursor-pointer opacity-0"
        value={value} min={min} max={max} disabled={disabled}
        onClick={event => {
          // iOSは入力自体へのタップで開くため、showPickerがなくても標準動作を残す。
          try { event.currentTarget.showPicker?.() } catch { /* 標準のフォーカス・クリックへ委ねる。 */ }
        }}
        onChange={event => { setDraft(null); onChange(event.target.value) }} />
    </span>
    {error && <span id={`${id}-error`} className="mt-1 block text-xs text-red-500">{error}</span>}
  </span>
}
