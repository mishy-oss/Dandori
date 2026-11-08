import type { Issue } from '../../db/types'
import type { IconName } from '../../app/Icon'

const PALETTE = ['#ef9896', '#6f94af', '#96ba72', '#a66386', '#d6ad67', '#7bb5ad']

/** タイトルと種別から表示用のアイコンと色を選ぶ。保存済みの独自色があれば優先する。 */
export function taskAppearance(issue: Issue): { color: string; icon: IconName } {
  const title = issue.title.toLowerCase()
  let icon: IconName = 'task'
  if (/コーヒー|休憩|coffee|カフェ/.test(title)) icon = 'coffee'
  else if (/運動|ヨガ|散歩|ジム|workout|走/.test(title)) icon = 'activity'
  else if (/勉強|読書|学習|本|read|study/.test(title)) icon = 'book'
  else if (/コード|実装|開発|修正|code|プログラム/.test(title)) icon = 'code'
  else if (/植物|水やり|garden/.test(title)) icon = 'leaf'
  else if (issue.type === 'epic') icon = 'flag'
  let hash = 0
  for (const character of issue.title) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const customColor = issue.color && !['#38bdf8', '#0ea5e9'].includes(issue.color.toLowerCase())
  return { icon, color: customColor ? issue.color : PALETTE[hash % PALETTE.length] }
}
