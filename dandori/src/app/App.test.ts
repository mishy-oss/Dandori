import { expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { App } from './App'

vi.mock('./PwaToast', () => ({ PwaToast: () => null }))

it('offers timeline, unified board and settings without a duplicate task tab', () => {
  vi.stubGlobal('location', { search: '' })
  try {
    const html = renderToStaticMarkup(createElement(App))
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? ''
    expect(nav).toContain('aria-label="メイン"')
    expect(nav.match(/<button/g)).toHaveLength(3)
    expect(nav).toContain('予定</button>')
    expect(nav).toContain('ボード</button>')
    expect(nav).toContain('設定</button>')
    expect(nav).not.toContain('タスク</button>')
  } finally {
    vi.unstubAllGlobals()
  }
})
