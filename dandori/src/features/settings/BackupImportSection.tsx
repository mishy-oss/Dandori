import { useEffect, useId, useRef, useState } from 'react'
import { MAX_BACKUP_BYTES, parseBackup, type BackupFile } from '../../db/backupImport'
import { useThemeStore } from '../../store/theme'
import { useAccountStore } from '../account/accountStore'
import { sameValue } from '../account/syncModel'
import { prepareBackupRestore, restorePreparedBackup, resumeAccountRestore, type PreparedRestore } from './restoreBackup'

interface RecoveryDownload { url: string; filename: string; cloud: boolean }
interface RestorePreview { filename: string; session: PreparedRestore }
const BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 text-sm disabled:opacity-40'

export function BackupImportSection({ disabled = false }: { disabled?: boolean }) {
  const theme = useThemeStore(state => state.theme)
  const setTheme = useThemeStore(state => state.setTheme)
  const accountBusy = useAccountStore(state => state.busy)
  const restorePending = useAccountStore(state => state.restorePending)
  const authenticated = useAccountStore(state => state.authenticated)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [downloads, setDownloads] = useState<RecoveryDownload[]>([])
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmedRecovery, setConfirmedRecovery] = useState(false)
  const busyRef = useRef(false)
  const activeRef = useRef(true)
  const urls = useRef<string[]>([])
  const inputId = useId()

  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false; urls.current.forEach(url => URL.revokeObjectURL(url)) }
  }, [])

  async function readFile(file: File) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null); setMessage(null)
    const created: string[] = []
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new Error('JSONファイルは20MB以下にしてください。')
      const backup = parseBackup(await file.text())
      const session = await prepareBackupRestore(backup, theme)
      if (!activeRef.current) return
      const sources = [{ backup: session.before, cloud: false }]
      if (session.cloudBefore && !sameValue(session.before.data, session.cloudBefore.data)) sources.push({ backup: session.cloudBefore, cloud: true })
      const next = sources.map(({ backup, cloud }) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }))
        created.push(url)
        return { url, cloud, filename: `dandori-before-restore-${cloud ? 'cloud-' : ''}${backup.exportedAt.replace(/[:.]/g, '-')}.json` }
      })
      urls.current.forEach(url => URL.revokeObjectURL(url))
      urls.current = created
      setDownloads(next)
      setPreview({ filename: file.name, session })
    } catch (cause) {
      created.forEach(url => URL.revokeObjectURL(url))
      if (activeRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { busyRef.current = false; if (activeRef.current) setBusy(false) }
  }

  async function restore() {
    if (!preview || busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null)
    try {
      const warning = await restorePreparedBackup(preview.session)
      let themeWarning = ''
      try { setTheme(preview.session.backup.theme) } catch { themeWarning = 'テーマの反映にはアプリの再読み込みが必要です。' }
      if (activeRef.current) {
        setPreview(null)
        setMessage(warning ?? `バックアップを復元しました。${themeWarning}`)
      }
    } catch (cause) {
      if (activeRef.current) {
        if (useAccountStore.getState().restorePending) setPreview(null)
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally { busyRef.current = false; if (activeRef.current) setBusy(false) }
  }

  async function resume(useCurrentCloud: boolean) {
    if (!confirmedRecovery || busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const { warning, theme } = await resumeAccountRestore(useCurrentCloud)
      let themeWarning = ''
      try { if (theme) setTheme(theme) } catch { themeWarning = 'テーマの反映にはアプリの再読み込みが必要です。' }
      if (activeRef.current) {
        setConfirmedRecovery(false)
        setMessage(warning ?? `クラウドの内容を端末に反映しました。${themeWarning}`)
      }
    } catch (cause) {
      if (activeRef.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally { busyRef.current = false; if (activeRef.current) setBusy(false) }
  }

  const recoveryDisabled = disabled || busy || accountBusy || !authenticated
  return <div className="mt-4 border-t border-border pt-4">
    <h3 className="mb-2 text-sm font-semibold">JSONから復元</h3>
    <p className="mb-3 text-sm text-muted">保存済みのバックアップJSONを選び、日時と件数を確認して復元できます。ファイルを選ぶだけでは現在のデータは変わりません。</p>
    <label htmlFor={inputId} className="mb-1 block text-xs text-muted">バックアップJSONを選択</label>
    <input id={inputId} type="file" accept=".json,application/json" aria-label="バックアップJSONを選択" disabled={disabled || busy || accountBusy || restorePending}
      className="block min-h-11 w-full min-w-0 rounded-lg border border-border p-2 text-sm disabled:opacity-40"
      onChange={event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) void readFile(file) }} />
    {restorePending && <div className="mt-3 grid gap-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">途中の復元があります</p>
      <p className="text-sm text-muted">復元を再開するまでは通常の同期が止まります。端末の内容を置き換えるため、必要なデータは先にJSONで保存してください。{!authenticated && '再開するにはGoogleにログインしてください。'}</p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" disabled={recoveryDisabled} checked={confirmedRecovery} onChange={event => setConfirmedRecovery(event.target.checked)} />
        この端末のデータを置き換えることを確認しました
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={BUTTON} disabled={recoveryDisabled || !confirmedRecovery} onClick={() => void resume(false)}>復元を再開</button>
        <button type="button" className={BUTTON} disabled={recoveryDisabled || !confirmedRecovery} onClick={() => void resume(true)}>現在のクラウドを端末に反映</button>
      </div>
      <p className="text-xs text-muted">別の端末でクラウドが更新されていた場合は「現在のクラウドを端末に反映」を使えます。</p>
    </div>}
    {busy && !preview && <p role="status" className="mt-2 text-sm text-muted">{restorePending ? '復元の状態を確認しています…' : 'JSONと復元先の状態を確認しています…'}</p>}
    {downloads.length > 0 && !preview && <RecoveryLinks downloads={downloads} />}
    {message && <p role="status" className="mt-3 text-sm text-muted">{message}</p>}
    {error && !preview && <p role="alert" className="mt-3 text-sm text-red-500">{error}</p>}
    {preview && <RestoreBackupDialog preview={preview} downloads={downloads} busy={busy} error={error} onRestore={() => void restore()}
      onClose={() => { if (!busyRef.current) { setPreview(null); setError(null) } }} />}
  </div>
}

function RecoveryLinks({ downloads }: { downloads: RecoveryDownload[] }) {
  return <div className="mt-3 flex flex-wrap gap-2">{downloads.map(download => <a key={download.url} href={download.url} download={download.filename} className={BUTTON}>{download.cloud ? '復元前のクラウドJSONを保存' : '復元前の端末JSONを保存'}</a>)}</div>
}

function currentCount(backup: BackupFile) { return backup.data.issues.filter(issue => issue.deletedAt === null && !issue.carryoverToId).length }

export function RestoreBackupDialog({ preview, downloads, busy, error, onRestore, onClose }: {
  preview: RestorePreview; downloads: RecoveryDownload[]; busy: boolean; error: string | null; onRestore: () => void; onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [confirmed, setConfirmed] = useState(false)
  const id = useId()
  const file = preview.session.backup
  useEffect(() => {
    const dialog = dialogRef.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={dialogRef} role="alertdialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface p-4 text-text shadow-xl backdrop:bg-black/50"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <h2 id={`${id}-title`} className="mb-3 text-lg font-bold">バックアップを復元しますか？</h2>
    <p className="break-all text-sm">{preview.filename}</p>
    <dl className="my-3 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      <dt>書き出し日時</dt><dd>{new Date(file.exportedAt).toLocaleString('ja-JP')}</dd>
      <dt>タスク（現在分）</dt><dd>{currentCount(file)}件（履歴・削除済みを含む総件数 {file.data.issues.length}件）</dd>
      <dt>繰り返し設定</dt><dd>{file.data.recurrenceRules.length}件</dd>
      <dt>月次履歴</dt><dd>{file.data.monthlySnapshots.length}件</dd>
      <dt>テーマ</dt><dd>{{ system: 'システム', light: 'ライト', dark: 'ダーク' }[file.theme]}</dd>
      <dt>現在の端末</dt><dd>{currentCount(preview.session.before)}タスク</dd>
    </dl>
    <p id={`${id}-description`} className="text-sm">現在のタスク・ラベル・繰り返し設定・月次履歴・設定を、このファイルの内容で置き換えます。ファイルにないタスクは一覧からなくなります。先に復元前のJSONを保存してください。</p>
    {preview.session.accountId && <p className="mt-3 text-sm font-medium">現在のGoogleアカウントへ復元し、他の端末にも反映します。ログイン情報は復元しません。端末とクラウドの内容が異なる場合は、両方の復元前JSONを保存できます。</p>}
    {preview.session.accountId && file.data.projects.length > 1 && <p className="mt-2 text-xs text-muted">複数のプロジェクトは現在のアカウントにまとめます。重複するタスク番号は採番し直し、月次履歴は日付ごとにまとめます。</p>}
    <RecoveryLinks downloads={downloads} />
    <label className="my-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />現在のデータを置き換えることを確認しました</label>
    {error && <p role="alert" className="my-3 text-sm text-red-500">{error}</p>}
    <div className="mt-4 flex gap-3">
      <button type="button" autoFocus disabled={busy} onClick={onClose} className={`${BUTTON} flex-1`}>キャンセル</button>
      <button type="button" disabled={busy || !confirmed} onClick={onRestore} className="min-h-11 flex-1 rounded-lg bg-red-600 px-3 text-sm text-white disabled:opacity-40">{busy ? '復元中…' : '復元する'}</button>
    </div>
  </dialog>
}
