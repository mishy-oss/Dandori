export interface AccountIdentity { id: string; email: string; name: string }
const KEY = 'dandori_active_account'
export function readActiveAccount(): AccountIdentity | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null') as AccountIdentity | null
    return value && /^[a-zA-Z0-9_-]{1,255}$/.test(value.id) && typeof value.email === 'string' && typeof value.name === 'string' ? value : null
  } catch { return null }
}
export function selectAccount(user: AccountIdentity | null): void {
  if (user) localStorage.setItem(KEY, JSON.stringify(user))
  else localStorage.removeItem(KEY)
}
export function activeDatabaseName(): string {
  const account = readActiveAccount()
  return account ? `dandori-account-${account.id}` : 'dandori'
}
