// カード/行/ブロック内に置く完了ボタン。押しても親の編集・ドラッグ・スワイプを起こさない
export function DoneCheckButton({
  done,
  onToggle,
  className = '',
}: {
  done: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      data-no-drag
      aria-label={done ? '未完了に戻す' : '完了にする'}
      aria-pressed={done}
      onClick={/* クリックの伝播を止め、Issueの完了状態だけを切り替える。 */ (e) => {
        e.stopPropagation()
        onToggle()
      }}
      onKeyDown={/* キー操作が親の編集・ドラッグ処理へ伝わらないようにする。 */ (e) => e.stopPropagation()}
      className={`flex size-11 shrink-0 items-center justify-center rounded-full ${className}`}
    >
      <span
        aria-hidden
        className={`flex size-6 items-center justify-center rounded-full border-2 text-sm leading-none ${
          done ? 'border-accent bg-accent text-accent-text' : 'border-muted text-transparent'
        }`}
      >
        ✓
      </span>
    </button>
  )
}
