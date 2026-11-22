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
    <div className="flex items-center gap-1 px-3 pb-4" role="group" aria-label="週">
      <button
        aria-label="前の週"
        onClick={() => onShiftWeek(-1)}
        className="min-h-14 w-6 shrink-0 rounded-full text-xl text-muted hover:bg-surface"
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
              className="relative flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-full text-xs"
            >
              <span className="text-xs font-normal text-muted">{format(date, 'E', { locale: ja })}</span>
              <span className={`flex size-8 items-center justify-center rounded-full text-sm font-semibold ${isSelected ? 'bg-accent text-accent-text' : d === today ? 'text-accent ring-1 ring-accent/40' : 'text-text'}`}>{format(date, 'd')}</span>
              {marked.has(d) && (
                <span
                  aria-hidden
                  className="absolute bottom-0.5 h-1 w-3 rounded-full bg-accent/65"
                />
              )}
            </button>
          )
        })}
      </div>
      <button
        aria-label="次の週"
        onClick={() => onShiftWeek(1)}
        className="min-h-14 w-6 shrink-0 rounded-full text-xl text-muted hover:bg-surface"
      >
        ›
      </button>
    </div>
  )
}
