import Dexie, { type Table } from 'dexie'

export async function inTransaction<T>(database: Dexie, mode: 'r' | 'rw', tables: readonly Table[], operation: () => Promise<T>): Promise<T> {
  const current = Dexie.currentTransaction
  if (!current) return database.transaction(mode, [...tables], operation)
  try {
    if (current.db !== database || !current.active || (mode === 'rw' && current.mode !== 'readwrite') || tables.some(table => !current.storeNames.includes(table.name))) {
      throw new Error('Transaction scope mismatch')
    }
    return await operation()
  } catch (cause) {
    // 呼び出し側が例外を捕捉しても、途中までの更新だけを確定させない。
    current.abort()
    throw cause
  }
}
