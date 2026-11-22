import type { ComponentProps } from 'react'
import { Icon } from './Icon'

type Props = Pick<ComponentProps<'button'>, 'onClick' | 'disabled' | 'aria-label' | 'title'> & { children: string }

export function DateJumpButton({ children, ...props }: Props) {
  return <button
    {...props}
    type="button"
    data-no-drag
    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-accent/25 bg-surface px-3 text-xs font-medium whitespace-nowrap text-accent disabled:opacity-50"
  >
    <Icon name="clock" className="size-4 shrink-0" />
    {children}
  </button>
}
