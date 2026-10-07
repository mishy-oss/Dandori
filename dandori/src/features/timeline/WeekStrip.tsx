import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'

export function WeekStrip({
  days,
  selected,
  today,
  marked,
  onSelect,
  onShiftWeek,
}: {
  days: string[]
  selected: string
  today: string
  marked: Set<string>
  onSelect: (date: string) => void
  onShiftWeek: (delta: -1 | 1) => void
}) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="週">
      <button
        aria-label="前の週"
        onClick={() => onShiftWeek(-1)}
        className="min-h-11 min-w-9 rounded-lg text-lg text-muted"
      >
        ‹
      </button>
      <div className="grid flex-1 grid-cols-7 gap-1">
        {days.map((d) => {
          const date = parseISO(d)
          const isSelected = d === selected
          return (
            <button
              key={d}
              aria-label={format(date, 'M月d日(E)', { locale: ja })}
              aria-pressed={isSelected}
              onClick={() => onSelect(d)}
              className={`relative flex min-h-14 flex-col items-center justify-center rounded-xl text-xs ${
                isSelected ? 'bg-accent text-accent-text' : 'bg-surface'
              } ${d === today && !isSelected ? 'ring-1 ring-accent' : ''}`}
            >
              <span className={isSelected ? '' : 'text-muted'}>{format(date, 'E', { locale: ja })}</span>
              <span className="text-base font-semibold">{format(date, 'd')}</span>
              {marked.has(d) && (
                <span
                  aria-hidden
                  className={`absolute bottom-1 size-1 rounded-full ${isSelected ? 'bg-accent-text' : 'bg-accent'}`}
                />
              )}
            </button>
          )
        })}
      </div>
      <button
        aria-label="次の週"
        onClick={() => onShiftWeek(1)}
        className="min-h-11 min-w-9 rounded-lg text-lg text-muted"
      >
        ›
      </button>
    </div>
  )
}
