import { useEffect } from 'react'
import { applyTheme, useThemeStore } from '../store/theme'

/** 選択したテーマを画面に適用し、システム設定に従う場合はOS側の明暗の変更にも追従する。 */
export function useThemeEffect() {
  const theme = useThemeStore(/* ストアからテーマを取得する。 */ (s) => s.theme)

  useEffect(/* テーマを適用し、systemの場合はOSの配色変更の監視を登録する。設定変更時には以前の監視を解除する。 */ () => {
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    /** OSの配色設定の変更を受け、systemテーマを現在の明暗へ適用し直す。 */
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return /* 登録したイベント監視や待機中のタイマーを解除し、画面破棄後に処理が残らないようにする。 */ () => mq.removeEventListener('change', onChange)
  }, [theme])
}
