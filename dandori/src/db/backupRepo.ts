import { db } from './db'
import { DEFAULT_SETTINGS } from './types'
import type { ThemeSetting } from '../store/theme'

/* 読み取り中の更新で親子関係などが食い違わないよう、全テーブルを同じトランザクションで取得する。 */
export async function createBackup(theme: ThemeSetting) {
  return db.transaction('r', db.tables, async () => {
    const [projects, workflows, issues, recurrenceRules, sprints, savedSettings, monthlySnapshots] = await Promise.all([
      db.projects.toArray(),
      db.workflows.toArray(),
      db.issues.toArray(),
      db.recurrenceRules.toArray(),
      db.sprints.toArray(),
      db.settings.toArray(),
      db.monthlySnapshots.toArray(),
    ])
    return {
      format: 'dandori-backup',
      formatVersion: 1,
      databaseVersion: db.verno,
      exportedAt: new Date().toISOString(),
      theme,
      data: {
        projects,
        workflows,
        issues,
        recurrenceRules,
        sprints,
        settings: savedSettings.length > 0 ? savedSettings : [{ ...DEFAULT_SETTINGS }],
        monthlySnapshots,
      },
    }
  })
}
