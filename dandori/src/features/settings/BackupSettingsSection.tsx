import { useEffect, useRef, useState } from 'react'
import { createBackup } from '../../db/backupRepo'
import { useDataStore } from '../../store/data'
import { useThemeStore } from '../../store/theme'
import { BackupImportSection } from './BackupImportSection'

interface BackupDownload {
  url: string
  filename: string
  exportedAt: number
}

export function BackupSettingsSection() {
  const theme = useThemeStore((state) => state.theme)
  const lastBackupAt = useDataStore((state) => state.settings.lastBackupAt)
  const updateSettings = useDataStore((state) => state.updateSettings)
  const [download, setDownload] = useState<BackupDownload | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const activeRef = useRef(true)
  const preparingRef = useRef(false)
  const downloadUrlRef = useRef<string | null>(null)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
    }
  }, [])

  /* 非同期の準備後も端末側で保存操作を行えるよう、ファイル生成とダウンロードを分ける。 */
  async function prepare() {
    if (preparingRef.current) return
    preparingRef.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const backup = await createBackup(theme)
      if (!activeRef.current) return
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      if (downloadUrlRef.current) URL.revokeObjectURL(downloadUrlRef.current)
      downloadUrlRef.current = url
      setDownload({
        url,
        filename: `dandori-backup-${backup.exportedAt.replace(/[:.]/g, '-')}.json`,
        exportedAt: Date.parse(backup.exportedAt),
      })
      setMessage('JSONの準備ができました。「JSONを保存」を押してください。')
    } catch (cause) {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      preparingRef.current = false
      if (activeRef.current) setBusy(false)
    }
  }

  /* ブラウザーから保存完了は確認できないため、保存リンクの操作時にデータ取得時点だけを記録する。 */
  async function recordDownload() {
    if (!download) return
    setError(null)
    setMessage('ダウンロードを開始しました。保存先でJSONファイルをご確認ください。')
    try {
      await updateSettings({ lastBackupAt: download.exportedAt })
    } catch {
      if (activeRef.current) setError('ダウンロードは開始しましたが、書き出し日時を記録できませんでした。')
    }
  }

  return <section aria-labelledby="backup-heading" className="rounded-xl border border-border bg-surface p-4">
    <h2 id="backup-heading" className="mb-3 text-sm font-semibold text-muted">バックアップ</h2>
    <p className="mb-3 text-sm text-muted">タスク・ラベル・繰り返し設定・月次履歴・設定をJSONファイルに書き出します。準備後に「JSONを保存」を押し、端末やクラウドに保存してください。</p>
    <p className="mb-3 text-xs text-muted">前回の書き出しデータ日時：{lastBackupAt ? new Date(lastBackupAt).toLocaleString('ja-JP') : '未実施'}</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void prepare()}
        className="min-h-11 rounded-lg border border-border px-3 text-sm disabled:opacity-40">{busy ? '準備中…' : 'JSONを準備'}</button>
      {download && <a href={download.url} download={download.filename} onClick={() => void recordDownload()}
        className="inline-flex min-h-11 items-center rounded-lg bg-accent px-3 text-sm font-semibold text-accent-text">JSONを保存</a>}
    </div>
    {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    <BackupImportSection disabled={busy} />
  </section>
}
