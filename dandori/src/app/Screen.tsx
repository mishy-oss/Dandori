import type { ReactNode } from 'react'

/** 画面タイトルと本文を共通の余白・縦並びレイアウトで表示する。 */
export function Screen({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children}
    </section>
  )
}

/** 指定した開発フェーズで実装予定であることを表示する。 */
export function Placeholder({ phase }: { phase: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
      {phase}で実装予定
    </p>
  )
}
