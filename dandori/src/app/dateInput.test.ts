import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { displayInputDate, readInputDate } from './dateInput'
import { DateField } from './DateField'

it('shows Japanese weekdays explicitly for the reported dates without empty parentheses', () => {
  expect(displayInputDate('2026-11-17')).toBe('2026/11/17 (火)')
  expect(displayInputDate('2026-11-20')).toBe('2026/11/20 (金)')
  expect(displayInputDate('')).toBe('')
  const html = renderToStaticMarkup(createElement(DateField, { label: '日付', value: '2026-11-20', onChange: () => {} }))
  expect(html).toContain('type="text"')
  expect(html).toContain('value="2026/11/20 (金)"')
  expect(html).toContain('aria-label="日付をカレンダーから選択"')
  expect(html).toContain('type="date"')
  expect(html).not.toContain('()')
})

it('accepts numeric typing, slash or ISO dates and full-width digits without shifting the date', () => {
  for (const input of ['20261120', '2026/11/20', '2026-11-20', '２０２６／１１／２０']) expect(readInputDate(input)).toEqual({ value: '2026-11-20', error: '' })
  expect(readInputDate('2026/1/2')).toEqual({ value: '2026-01-02', error: '' })
  expect(readInputDate('2028/02/29')).toEqual({ value: '2028-02-29', error: '' })
  expect(readInputDate('  ')).toEqual({ value: '', error: '' })
})

it('rejects incomplete, impossible and out-of-range dates while allowing the exact bounds', () => {
  for (const input of ['2026/11/', '2026/02/29', '2026/11/31', '2026/00/01', '0000/01/01', 'tomorrow']) expect(readInputDate(input)).toMatchObject({ value: null, error: expect.any(String) })
  expect(readInputDate('20261120', '2026-11-21').error).toContain('2026/11/21 (土)以降')
  expect(readInputDate('20261123', undefined, '2026-11-22').error).toContain('2026/11/22 (日)以前')
  expect(readInputDate('20261121', '2026-11-21', '2026-11-21')).toEqual({ value: '2026-11-21', error: '' })
})
