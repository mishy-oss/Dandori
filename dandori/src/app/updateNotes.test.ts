import { afterEach, expect, it, vi } from 'vitest'
import { commitEntries, fetchReleaseNotes, fetchUpdateNotes, formatCommitDate } from './updateNotes'

const current = 'a'.repeat(40)
const target = 'b'.repeat(40)

it('extracts valid commit dates without dropping undated messages', () => {
  const entries = commitEntries([
    { sha: current, commit: { message: '変更1', committer: { date: '2026-11-11T16:30:00Z' }, author: { date: '2026-11-10T12:00:00Z' } } },
    { sha: target, commit: { message: '変更2', committer: { date: 'invalid' }, author: { date: '2026-11-10T12:00:00Z' } } },
    { sha: 'c'.repeat(40), commit: { message: '変更3' } },
  ])
  expect(entries.map((entry) => entry.date)).toEqual(['2026-11-11T16:30:00.000Z', '2026-11-10T12:00:00.000Z', undefined])
  expect(entries).toHaveLength(3)
})

it('formats dates in Japan time regardless of device timezone', () => {
  expect(formatCommitDate('2026-11-11T16:30:00Z')).toBe('2026/11/12')
  expect(formatCommitDate('2026-11-11T14:30:00Z')).toBe('2026/11/11')
  expect(formatCommitDate('invalid')).toBe('')
})

afterEach(() => vi.unstubAllGlobals())

function commit(sha: string, message: string, merge = false) {
  return { sha, commit: { message }, parents: merge ? [{}, {}] : [{}] }
}

it('shows only the first line of up to five non-merge commit messages', () => {
  const data = [commit(current, 'Merge pull request #1', true), commit(target, '機能追加\n\n詳細'), commit('invalid', '不正'),
    ...Array.from({ length: 8 }, (_, index) => commit(index.toString().repeat(40), `修正${index}`))]
  const entries = commitEntries(data)
  expect(entries).toHaveLength(5)
  expect(entries[0]).toEqual({ sha: target, message: '機能追加', url: `https://github.com/mishy-oss/Dandori/commit/${target}` })
})

it('compares the running build with the deployed commit', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ commit: target })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ahead', commits: [commit(current, '以前の修正'), commit(target, '最新の修正')] })))
  vi.stubGlobal('fetch', request)
  const notes = await fetchUpdateNotes(current, new AbortController().signal)
  expect(request.mock.calls[0][0]).toBe('/version.json')
  expect(request.mock.calls[0][1].cache).toBe('no-store')
  expect(request.mock.calls[1][0]).toBe(`https://api.github.com/repos/mishy-oss/Dandori/compare/${current}...${target}`)
  expect(notes.recent).toBe(false)
  expect(notes.entries.map((entry) => entry.message)).toEqual(['最新の修正', '以前の修正'])
  expect(notes.url).toContain(`${current}...${target}`)
})

it('labels rollback history as recent changes and pins it to the deployed SHA', async () => {
  const request = vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ commit: target })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'behind', commits: [] })))
    .mockResolvedValueOnce(new Response(JSON.stringify([commit(target, '公開済みの変更')])) )
  vi.stubGlobal('fetch', request)
  const notes = await fetchUpdateNotes(current, new AbortController().signal)
  expect(notes.recent).toBe(true)
  expect(request.mock.calls[2][0]).toContain(`commits?sha=${target}&per_page=20`)
})

it('reports GitHub API errors', async () => {
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(new Response(JSON.stringify({ commit: target })))
    .mockResolvedValueOnce(new Response('', { status: 403 })))
  await expect(fetchUpdateNotes(current, new AbortController().signal)).rejects.toThrow('GitHub 403')
})

it('rejects missing or invalid deployment metadata', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ commit: 'main' })))
  vi.stubGlobal('fetch', request)
  await expect(fetchUpdateNotes(current, new AbortController().signal)).rejects.toThrow('Invalid version')
  expect(request).toHaveBeenCalledTimes(1)
})

it('loads up to five release notes for the installed version', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(
    Array.from({ length: 25 }, (_, index) => commit(index.toString(16).padStart(40, '0'), `変更${index}`)),
  )))
  vi.stubGlobal('fetch', request)
  const notes = await fetchReleaseNotes(current, new AbortController().signal)
  expect(request).toHaveBeenCalledTimes(1)
  expect(request.mock.calls[0][0]).toBe(`https://api.github.com/repos/mishy-oss/Dandori/commits?sha=${current}&per_page=50`)
  expect(notes.entries).toHaveLength(5)
  expect(notes.url).toBe(`https://github.com/mishy-oss/Dandori/commits/${current}`)
})

it('does not fetch unrelated history when the installed version is unknown', async () => {
  const request = vi.fn()
  vi.stubGlobal('fetch', request)
  await expect(fetchReleaseNotes('', new AbortController().signal)).rejects.toThrow('Version unavailable')
  expect(request).not.toHaveBeenCalled()
})
