import type { ReactNode } from 'react'

/** 画面下部に共通のダイアログを表示し、背景のクリックで閉じる。ダイアログ内のクリックは背景に伝えない。 */
export function Sheet({
  label,
  onClose,
  children,
}: {
  label: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={/* クリックが背景へ伝わってダイアログを閉じないようにする。 */ (e) => e.stopPropagation()}
        className="mx-auto flex max-h-[90%] w-full max-w-xl flex-col gap-3 overflow-y-auto rounded-t-2xl bg-surface p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
      >
        {children}
      </div>
    </div>
  )
}
