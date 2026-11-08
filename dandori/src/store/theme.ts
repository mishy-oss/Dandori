import { create } from 'zustand'

export type ThemeSetting = 'system' | 'light' | 'dark'

const STORAGE_KEY = 'dandori:theme'
const THEME_COLORS = { light: '#f4f3f6', dark: '#0f172a' } as const

/** 保存されたテーマ設定を取得し、不正な値やストレージ利用不可の場合はsystemを返す。 */
function readStored(): ThemeSetting {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // ストレージが使えない環境では既定値を使う
  }
  return 'system'
}

/** テーマ設定がsystemならOSの明暗設定を調べ、最終的にlightまたはdarkへ解決する。 */
export function resolveTheme(setting: ThemeSetting): 'light' | 'dark' {
  if (setting !== 'system') return setting
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

/** 解決したテーマをHTML要素とtheme-colorメタタグへ反映し、画面とブラウザー枠の色を合わせる。 */
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
export const useThemeStore = create<ThemeState>(/* 保存されたテーマを初期値とし、選択変更と永続化を行うZustandストアを構築する。 */ (set) => ({
  theme: readStored(),
  /** 選択されたテーマをlocalStorageへ保存して画面へ適用し、ストアの選択値も更新する。 */
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
