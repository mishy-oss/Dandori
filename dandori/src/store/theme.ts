import { create } from 'zustand'

export type ThemeSetting = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'dandori:theme'
const THEME_COLORS = { light: '#f4f3f6', dark: '#0f172a' } as const

function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // ストレージが使えない環境では既定値を使う
  }
  return 'system'
}

/* systemはCSSのテーマ値に使えないため、OSの配色に解決してから適用する。 */
export function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting !== 'system') return setting
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function applyTheme(setting: ThemeSetting) {
  const resolved = resolveTheme(setting)
  document.documentElement.dataset.theme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved])
}

interface ThemeState {
  theme: ThemeSetting
  setTheme: (theme: ThemeSetting) => void
}

// 初回描画前の適用(index.html)に使うため localStorage に保存する
export const useThemeStore = create<ThemeState>((set) => ({
  theme: readStored(),
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // 保存に失敗しても表示は切り替える
    }
    applyTheme(theme)
    set({ theme })
  },
}))
