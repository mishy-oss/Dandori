import { useState } from 'react'
import { accountApi, importDeviceTasks, loadCalendars, logoutAccount, runAccountAction, selectCalendar, startGoogleLogin, syncAccount, syncCalendar, useAccountStore } from './accountStore'

const BUTTON = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-3 text-sm disabled:opacity-40'

export function GoogleAccountSection() {
  const state = useAccountStore()
  const [selected, setSelected] = useState('')
  return <section aria-labelledby="google-account-heading" className="rounded-xl border border-border bg-surface p-4">
    <h2 id="google-account-heading" className="mb-3 text-sm font-semibold text-muted">Googleアカウントと同期</h2>
    <p className="mb-3 text-sm text-muted">同じGoogleアカウントでログインすると、別の端末でもタスクを使えます。オフラインの変更は再接続後に同期します。</p>
    {state.enabled === false && <p className="mb-3 text-sm text-muted">Google連携のサーバー設定が未完了です。設定手順はプロジェクトのGOOGLE_SYNC.mdを確認してください。</p>}
    {state.user ? <>
      <p className="break-all text-sm">{state.user.email}{!state.authenticated && '（再ログイン待ち・端末データは利用できます）'}</p>
      <p className="my-2 text-xs text-muted">前回のタスク同期：{state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString('ja-JP') : '未実施'}</p>
      <div className="flex flex-wrap gap-2">
        <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void syncAccount()}>タスクを同期</button>
        <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void importDeviceTasks()}>未ログイン時のタスクを取り込む</button>
        <button className={BUTTON} disabled={state.busy} onClick={() => void logoutAccount()}>ログアウト</button>
      </div>
      <p className="mt-2 text-xs text-muted">取り込みは明示的に実行します。未ログイン時のデータと、アカウントごとの端末データはそれぞれ残ります。</p>
      {state.conflicts.length > 0 && <div className="mt-3 rounded-lg border border-border p-3">
        <p className="text-sm">同時に編集されたデータ：{state.conflicts.slice(0,5).join('、')}</p>
        <p className="my-2 text-xs text-muted">先にバックアップを保存してから、競合したデータのどちらを優先するか選択してください。競合していない変更は両方とも残します。</p>
        <div className="flex flex-wrap gap-2">
          <button className={BUTTON} disabled={state.busy} onClick={() => void syncAccount('local')}>この端末の内容を優先</button>
          <button className={BUTTON} disabled={state.busy} onClick={() => void syncAccount('remote')}>クラウドの内容を優先</button>
        </div>
      </div>}
      <h3 className="mb-2 mt-5 text-sm font-semibold">Googleカレンダー</h3>
      <p className="mb-3 text-sm text-muted">選択した1つのカレンダーと、タイトル・説明・日時を双方向同期します。時刻を配置したタスクは予定として反映され、Googleの予定はRecurringのタスクになります。</p>
      <p className="mb-3 text-xs text-muted">タスクの削除・未配置への変更は、対応するGoogleの予定も削除します。Googleで削除した予定は、アプリでも削除済みになります。</p>
      {state.calendar && <p className="mb-2 text-sm">同期先：{state.calendar.name}（{state.calendar.timeZone}）</p>}
      <div className="flex flex-wrap gap-2">
        <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void startGoogleLogin(true)}>Googleカレンダーを連携・再認証</button>
        <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void runAccountAction(loadCalendars)}>カレンダー一覧を取得</button>
        {state.calendar && <>
          <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void syncCalendar()}>カレンダーと同期</button>
          <button className={BUTTON} disabled={state.busy || !state.authenticated} onClick={() => void runAccountAction(async () => {
            await accountApi('/api/account/calendar', { method: 'DELETE' })
            useAccountStore.setState({ calendar: null, calendars: [], calendarError: null, message: 'カレンダー連携を解除しました。タスクとGoogleの予定は残しています。' })
          })}>カレンダー連携を解除</button>
        </>}
      </div>
      {state.calendars.length > 0 && <div className="mt-3 flex flex-col gap-2">
        <label className="text-sm">同期するカレンダー
          <select className="mt-1 min-h-11 w-full rounded-lg border border-border bg-surface-2 px-2" value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">選択してください</option>
            {state.calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
          </select>
        </label>
        <button className={BUTTON} disabled={state.busy || !selected} onClick={() => void runAccountAction(() => selectCalendar(selected))}>このカレンダーと双方向同期を開始</button>
      </div>}
      <p className="mt-3 text-xs text-muted">取り込み対象は過去1年〜先1年。終日予定は1日分に対応します。複数日にまたがる予定・特殊な予定は対象外です。招待者のいる予定は取り込みのみ行い、Googleへ変更を送りません。同時編集時は上書きを止めます。</p>
      <p className="mt-2 text-xs text-muted">アプリを開いている間、タスクは約30秒ごと、カレンダーは約3分ごとに同期します。閉じている間の変更は次回起動時に反映します。</p>
    </> : null}
    {!state.authenticated && state.enabled !== false && <button className={`${BUTTON} mt-3`} disabled={state.busy || state.enabled !== true} onClick={() => void startGoogleLogin()}>Googleでログイン</button>}
    {state.busy && <p role="status" className="mt-3 text-sm text-muted">同期処理中…</p>}
    {state.message && <p role="status" className="mt-3 text-sm text-muted">{state.message}</p>}
    {(state.error || state.calendarError) && <p role="alert" className="mt-3 text-sm text-red-500">{state.error || state.calendarError}</p>}
  </section>
}
