const REPOSITORY = 'mishy-oss/Dandori'
const API = `https://api.github.com/repos/${REPOSITORY}`
const GITHUB = `https://github.com/${REPOSITORY}`
const SHA = /^[a-f0-9]{40}$/

export interface UpdateNotes {
  recent: boolean
  entries: { sha: string; message: string; url: string; date?: string }[]
  url: string
}

/** GitHubから得た日時が有効なら、タイムゾーン付きのISO形式へ揃える。 */
function validCommitDate(value: unknown): string | undefined {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return undefined
  return new Date(value).toISOString()
}

/** コミット日を日本時間の年月日にして表示する。不明な日付は表示しない。 */
export function formatCommitDate(value: string): string {
  const date = validCommitDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(date))
}

/** コミットの先頭行を指定件数（既定5件）まで取り出す。マージ操作だけのメッセージは除外する。 */
export function commitEntries(data: unknown, limit = 5): UpdateNotes['entries'] {
  if (!Array.isArray(data)) throw new Error('Invalid commit list')
  return data.flatMap((item) => {
    if (typeof item?.sha !== 'string' || !SHA.test(item.sha) || typeof item?.commit?.message !== 'string') return []
    const message = item.commit.message.split(/\r?\n/)[0].trim()
    if (!message || /^Merge\b/.test(message) || (Array.isArray(item.parents) && item.parents.length > 1)) return []
    const date = validCommitDate(item.commit.committer?.date) ?? validCommitDate(item.commit.author?.date)
    return [{ sha: item.sha, message: message.slice(0, 180), url: `${GITHUB}/commit/${item.sha}`, ...(date && { date }) }]
  }).slice(0, limit)
}

/** 公開APIのJSONを取得する。通信失敗や利用制限は呼び出し元で案内し、更新操作自体は妨げない。 */
async function githubJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal, credentials: 'omit', headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`GitHub ${response.status}`)
  return response.json()
}

/** 利用中のバージョンまでの最近の変更を取得する。未適用の新バージョンの変更は混ぜない。 */
export async function fetchReleaseNotes(current: string, signal: AbortSignal): Promise<UpdateNotes> {
  if (!SHA.test(current)) throw new Error('Version unavailable')
  const result = await githubJson(`${API}/commits?sha=${current}&per_page=50`, signal)
  return { recent: true, entries: commitEntries(result), url: `${GITHUB}/commits/${current}` }
}

/** 今のアプリからデプロイ済みバージョンまでの変更を取得する。履歴が分岐した場合は対象版の最近の変更を示す。 */
export async function fetchUpdateNotes(current: string, signal: AbortSignal): Promise<UpdateNotes> {
  const response = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store', credentials: 'omit', signal })
  if (!response.ok) throw new Error('Version unavailable')
  const version: unknown = await response.json()
  const target = typeof version === 'object' && version !== null && 'commit' in version ? version.commit : null
  if (typeof target !== 'string' || !SHA.test(target)) throw new Error('Invalid version')
  if (SHA.test(current) && current !== target) {
    const comparison = `${current}...${target}`
    const result = await githubJson(`${API}/compare/${comparison}`, signal)
    if (typeof result === 'object' && result !== null && 'status' in result && result.status === 'ahead' && 'commits' in result) {
      const entries = commitEntries(Array.isArray(result.commits) ? [...result.commits].reverse() : result.commits)
      return { recent: false, entries, url: `${GITHUB}/compare/${comparison}` }
    }
  }
  const result = await githubJson(`${API}/commits?sha=${target}&per_page=20`, signal)
  return { recent: true, entries: commitEntries(result), url: `${GITHUB}/commits/${target}` }
}
