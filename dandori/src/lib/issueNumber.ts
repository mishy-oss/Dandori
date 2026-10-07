// プロジェクトを UI に出さないため、Issue は連番だけで識別する(例: #12)
export function formatIssueNumber(number: number): string {
  return `#${number}`
}
