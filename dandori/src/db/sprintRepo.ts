import { db } from './db'
import type { Sprint } from './types'

// 月次管理への移行前に保存された繰り返しタスクが、旧スプリントの期間を参照する。
export async function getSprint(id: string): Promise<Sprint | undefined> {
  const sprint = await db.sprints.get(id)
  return sprint?.deletedAt === null ? sprint : undefined
}
