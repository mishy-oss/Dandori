import type { Issue } from '../../db/types'
import { Icon } from '../../app/Icon'
import { taskAppearance } from './taskAppearance'
import type { TimelineDrag } from './useTimelineGestures'

/** 選択月の未配置タスクを横並びで表示し、編集とタイムラインへの配置を受け付ける。 */
export function UnplacedTray({
  issues,
  drag,
  onOpen,
  shouldSuppressClick,
}: {
  issues: Issue[]
  drag: TimelineDrag | null
  onOpen: (issue: Issue) => void
  shouldSuppressClick: () => boolean
}) {
  const ghost = drag?.kind === 'tray' ? issues.find(/* 指定IDと一致という条件を最初に満たす要素を探す。 */ (i) => i.id === drag.id) : undefined

  return (
    <section aria-label="未配置のIssue" className="flex shrink-0 flex-col gap-3 px-5 pb-4 pt-5">
      <h2 className="flex items-center justify-between text-[10px] font-medium tracking-wide text-muted">
        あとで予定する{issues.length > 0 ? ` · ${issues.length}` : ''}
        {issues.length > 0 && <span className="font-normal">長押しでタイムラインへ</span>}
      </h2>
      {issues.length === 0 ? (
        <p className="pb-1 text-[11px] text-muted">
          この月の未配置タスクはありません
        </p>
      ) : (
        <ul className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-1">
          {issues.map(/* 各Issueの表示要素を作り、対応する選択・編集操作を結び付ける。 */ (i) => (
            <li key={i.id} className="w-[76px] shrink-0">
              <div
                role="button"
                tabIndex={0}
                data-tray-id={i.id}
                onClick={/* 直前にジェスチャー操作をしていない場合だけ、対象Issueの編集画面を開く。 */ () => {
                  if (!shouldSuppressClick()) onOpen(i)
                }}
                onKeyDown={/* Enterまたはスペースで対象Issueを開き、キーボードからも編集できるようにする。 */ (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(i)
                  }
                }}
                onContextMenu={/* 長押しや右クリックによる標準メニューを抑止し、ジェスチャー操作を続けられるようにする。 */ (e) => e.preventDefault()}
                className={`flex w-full touch-pan-x select-none flex-col items-center gap-2 rounded-2xl py-1 text-center [-webkit-touch-callout:none] ${
                  ghost?.id === i.id ? 'opacity-40' : ''
                }`}
              >
                <span aria-hidden className="flex size-12 shrink-0 items-center justify-center rounded-full text-white" style={{ background: taskAppearance(i).color }}><Icon name={taskAppearance(i).icon} className="size-6" /></span>
                <span className="line-clamp-2 text-[11px] font-medium leading-snug">{i.title}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {drag?.kind === 'tray' && ghost && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 max-w-48 -translate-x-1/2 -translate-y-1/2 truncate rounded-full border border-accent bg-surface px-4 py-3 text-sm shadow-xl"
          style={{ left: drag.x, top: drag.y }}
        >
          {ghost.title}
        </div>
      )}
    </section>
  )
}
