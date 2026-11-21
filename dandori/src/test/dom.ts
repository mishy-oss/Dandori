import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect } from 'vitest'
import type { Issue } from '../db/types'
import { useDataStore } from '../store/data'

export function seedUi() {
  useDataStore.setState({
    ...useDataStore.getInitialState(), ready: true, selectedMonth: '2027-01', currentProjectId: 'project',
    projects: [{ id: 'project', key: 'APP', name: 'App', color: '#38bdf8', workflowId: 'workflow', nextNumber: 1, createdAt: 0, updatedAt: 0, deletedAt: null }],
    workflows: { workflow: { id: 'workflow', statuses: [
      { id: 'todo', name: 'To Do', category: 'todo' },
      { id: 'doing', name: 'In Progress', category: 'doing' },
      { id: 'routine', name: 'Recurring', category: 'routine' },
      { id: 'done', name: 'Done', category: 'done' },
    ], createdAt: 0, updatedAt: 0, deletedAt: null } },
  }, true)
}

export function task(id: string, patch: Partial<Issue> = {}): Issue {
  return {
    id, projectId: 'project', number: 1, title: id, type: 'task', priority: 'medium', statusId: 'todo',
    parentId: null, labels: [], dueDate: null, estimateMin: null, sprintId: null, planningMonth: '2027-01', rank: id,
    date: '2027-01-01', startMin: null, durationMin: 30, icon: '', color: '#38bdf8', reminderOffsetMin: null,
    recurrenceId: null, assigneeId: null, completedAt: null, createdAt: 0, updatedAt: 0, deletedAt: null, ...patch,
  }
}

export class DomView {
  readonly container = document.createElement('div')
  private root: Root

  constructor() {
    document.body.append(this.container)
    this.root = createRoot(this.container)
  }

  async render(node: ReactNode) { await act(async () => { this.root.render(node) }) }
  async dispose() {
    await act(async () => { this.root.unmount() })
    this.container.remove()
  }

  get<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = this.container.querySelector<T>(selector)
    expect(element, selector).not.toBeNull()
    return element!
  }

  button(text: string): HTMLButtonElement {
    const button = [...this.container.querySelectorAll('button')].find(button => button.textContent?.trim() === text)
    expect(button, text).toBeDefined()
    return button!
  }

  field(text: string): HTMLInputElement | HTMLSelectElement {
    const label = [...this.container.querySelectorAll('label')].find(label => label.childNodes[0]?.textContent?.trim() === text)
    expect(label, text).toBeDefined()
    return label!.querySelector('input, select')!
  }

  async click(element: HTMLElement) { await act(async () => { element.click() }) }

  async input(element: HTMLInputElement | HTMLSelectElement, value: string) {
    await act(async () => {
      // Reactの値追跡を迂回して、ブラウザが入力したときと同じイベントを送る。
      const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
      element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }

  async submit() {
    await act(async () => { this.get('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  }
}
