import { db } from '../db/db'
import type { Sprint } from '../db/types'

export async function insertLegacySprint(projectId: string, startDate: string, endDate: string): Promise<Sprint> {
  const sprint: Sprint = {
    id: 'legacy-sprint',
    projectId,
    name: '旧スプリント',
    startDate,
    endDate,
    state: 'planned',
    snapshots: [],
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
  }
  await db.sprints.add(sprint)
  return sprint
}
