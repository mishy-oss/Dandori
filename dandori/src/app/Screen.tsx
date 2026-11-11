import type { ReactNode } from 'react'

/** 画面タイトルと本文を共通の余白・縦並びレイアウトで表示する。 */
export function Screen({
  title,
  children,
  headerAction,
}: {
  title: string
  children?: ReactNode
  headerAction?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{title}</h1>
        {headerAction}
      </div>
      {children}
    </section>
  )
}

/** 指定した開発フェーズで実装予定であることを表示する。 */
export function Placeholder({ phase }: { phase: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
      {phase} is planned for implementation
    </p>
  )
}
