import { useState, type FormEvent } from 'react'
import { useDataStore } from '../../store/data'

const FIELD = 'min-h-11 rounded-lg border border-border bg-surface-2 px-3 text-base'

export function ProjectSection() {
  const { projects, currentProjectId, selectProject, createProject, deleteProject } =
    useDataStore()
  const [key, setKey] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    try {
      await createProject({ key, name })
      setKey('')
      setName('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="mb-3 text-sm font-semibold text-muted">プロジェクト</h2>

      <ul className="mb-4 flex flex-col gap-2">
        {projects.map((p) => (
          <li key={p.id} className="flex items-center gap-2">
            <button
              onClick={() => void selectProject(p.id)}
              aria-pressed={p.id === currentProjectId}
              className={`min-h-11 flex-1 rounded-lg border px-3 text-left text-sm ${
                p.id === currentProjectId ? 'border-accent' : 'border-border'
              }`}
            >
              <span className="font-semibold">{p.key}</span> {p.name}
            </button>
            <button
              aria-label={`${p.name}を削除`}
              onClick={() => {
                if (confirm(`「${p.name}」とIssueをすべて削除しますか?`)) void deleteProject(p.id)
              }}
              className="min-h-11 min-w-11 rounded-lg border border-border text-sm text-red-500"
            >
              削除
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="grid grid-cols-[6rem_1fr] gap-2">
          <input
            aria-label="キー"
            placeholder="KEY"
            className={FIELD}
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
          />
          <input
            aria-label="プロジェクト名"
            placeholder="プロジェクト名"
            className={FIELD}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        )}
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-accent text-sm font-semibold text-accent-text"
        >
          プロジェクトを作成
        </button>
      </form>
    </div>
  )
}
