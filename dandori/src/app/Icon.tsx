const PATHS = {
  timeline: 'M5 5h1m4 0h9M5 12h1m4 0h9M5 19h1m4 0h9',
  board: 'M4 4h16v16H4zM9 4v16M15 4v16M4 10h5m0 5h6m0-7h5',
  inbox: 'M5 5h14l3 12v3H2v-3L5 5Zm-3 12h6l2 3h4l2-3h6M8 9h8m-9 4h10',
  settings: 'm10 3 4 0 .7 3 2 .9 2.8-.8 2 3.5-2.2 2.1v2.6l2.2 2.1-2 3.5-2.8-.8-2 .9-.7 3h-4l-.7-3-2-.9-2.8.8-2-3.5 2.2-2.1v-2.6L2.5 9.6l2-3.5 2.8.8 2-.9L10 3ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  task: 'M8 4h12v16H4V8m-1-4 2 2 4-4M8 12h8m-8 4h5',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  coffee: 'M4 9h12v7a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Zm12 0h2a3 3 0 1 1 0 6h-2M7 2v3m4-3v3M2 22h17',
  activity: 'M12 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4M4 9l8 3 8-3m-8 3v9m0-5-6 5m6-5 6 5',
  book: 'M12 6C9 3 5 3 2 4v15c3-1 7-1 10 2m0-15c3-3 7-3 10-2v15c-3-1-7-1-10 2V6Z',
  code: 'm8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18',
  flag: 'M5 22V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0',
  leaf: 'M5 19C-2 8 10 2 21 3c0 13-7 21-16 16Zm0 0L16 8',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18m0 4v6l4 2',
} as const

export type IconName = keyof typeof PATHS

/** 共通の線画アイコンをSVGで描画し、文字絵文字に依存せず見た目を揃える。 */
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className}><path d={PATHS[name]} /></svg>
}
