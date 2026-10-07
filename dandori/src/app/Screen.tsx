import type { ReactNode } from 'react'

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

export function Placeholder({ phase }: { phase: string }) {
  return (
    <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">
      {phase}で実装予定
    </p>
  )
}
