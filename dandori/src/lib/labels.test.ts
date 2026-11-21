import { expect, it } from 'vitest'
import type { Issue } from '../db/types'
import { existingIssueLabels, labelKey, normalizeIssueLabels, suggestIssueLabels } from './labels'

function task(id: string, labels: string[], patch: Partial<Issue> = {}): Issue {
  return { id, projectId: 'project', labels, createdAt: 1, deletedAt: null, ...patch } as Issue
}

it('treats width, English case and whitespace variants as the same label while keeping meaningful separators', () => {
  expect(labelKey('  ＡＰＩ　連携  ')).toBe(labelKey('api  連携'))
  expect(labelKey('ｶﾚﾝﾀﾞｰ')).toBe(labelKey('カレンダー'))
  expect(labelKey('営業  会議')).not.toBe(labelKey('営業会議'))
  expect(normalizeIssueLabels([' ＡＰＩ ', 'api', '顧客,相談', '', '  ', 'Web　 会議'])).toEqual(['API', '顧客,相談', 'Web 会議'])
})

it('reuses existing spelling and never mutates the selected labels or dictionary', () => {
  const selected = ['api', 'ＡＰＩ', '仕事 ', '新規']
  const dictionary = ['API', '仕事']
  expect(normalizeIssueLabels(selected, dictionary)).toEqual(['API', '仕事', '新規'])
  expect(selected).toEqual(['api', 'ＡＰＩ', '仕事 ', '新規'])
  expect(dictionary).toEqual(['API', '仕事'])
})

it('offers labels across months and completion states, ignores deleted and archived tasks, and preserves the first spelling', () => {
  const issues = [
    task('new', ['api', '仕事'], { createdAt: 2 }),
    task('first', ['ＡＰＩ', 'API'], { planningMonth: '2026-01', statusId: 'done' }),
    task('deleted', ['削除済み'], { deletedAt: 1 }),
    task('history', ['過去の配置'], { carryoverToId: 'new' }),
    task('other', ['別プロジェクト'], { projectId: 'other' }),
  ]
  expect(existingIssueLabels(issues, 'project')).toEqual(['API', '仕事'])
  expect(existingIssueLabels([...issues].reverse(), 'project')).toEqual(['API', '仕事'])
  expect(issues[0].id).toBe('new')
})

it('narrows suggestions with normalized input, excludes selected variants and puts exact matches first', () => {
  const existing = ['社内API', 'API仕様', 'API', '買い物']
  expect(suggestIssueLabels(existing, [], 'ａｐｉ')).toEqual(['API', 'API仕様', '社内API'])
  expect(suggestIssueLabels(existing, [' ＡＰＩ '], 'api')).toEqual(['API仕様', '社内API'])
  expect(suggestIssueLabels(existing, ['買い物'], '')).toEqual(['社内API', 'API仕様', 'API'])
  expect(suggestIssueLabels(existing, [], '仕事')).toEqual([])
})
