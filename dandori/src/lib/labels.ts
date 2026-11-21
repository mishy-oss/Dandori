import type { Issue } from '../db/types'

export function normalizeLabel(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

export function labelKey(value: string): string {
  return normalizeLabel(value).toLowerCase()
}

export function normalizeIssueLabels(labels: string[], existing: string[] = []): string[] {
  const names = new Map<string, string>()
  for (const label of existing) {
    const key = labelKey(label)
    if (key && !names.has(key)) names.set(key, normalizeLabel(label))
  }
  const result = new Map<string, string>()
  for (const value of labels) {
    const label = normalizeLabel(value)
    const key = labelKey(label)
    if (key && !result.has(key)) result.set(key, names.get(key) ?? label)
  }
  return [...result.values()]
}

export function existingIssueLabels(issues: Issue[], projectId: string): string[] {
  const labels = new Map<string, { name: string; count: number }>()
  // 同期後も表記が揺れないよう、最初に使われた表記を優先する。
  const active = issues.filter(issue => issue.projectId === projectId && issue.deletedAt === null && !issue.carryoverToId)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const issue of active) {
    for (const label of normalizeIssueLabels(issue.labels)) {
      const key = labelKey(label)
      const existing = labels.get(key)
      if (existing) existing.count++
      else labels.set(key, { name: label, count: 1 })
    }
  }
  return [...labels.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ja')).map(label => label.name)
}

export function suggestIssueLabels(existing: string[], selected: string[], input: string): string[] {
  const query = labelKey(input)
  const selectedKeys = new Set(selected.map(labelKey))
  return existing.filter(label => !selectedKeys.has(labelKey(label)) && labelKey(label).includes(query))
    .sort((a, b) => Number(labelKey(b) === query) - Number(labelKey(a) === query) || Number(labelKey(b).startsWith(query)) - Number(labelKey(a).startsWith(query)))
}
