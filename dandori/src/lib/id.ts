import { ulid } from 'ulid'

export type ID = string

export function newId(): ID {
  return ulid()
}

export function now(): number {
  return Date.now()
}
