import { ulid } from 'ulid'

export type ID = string

/** 新しいULIDを生成し、プロジェクト・Issueなどを識別するIDとして返す。 */
export function newId(): ID {
  return ulid()
}

/** 作成・更新・削除日時の保存に使う、現在のUNIX時刻をミリ秒単位で返す。 */
export function now(): number {
  return Date.now()
}
