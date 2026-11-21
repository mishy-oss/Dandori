import { format, parseISO } from 'date-fns'
import { ja } from 'date-fns/locale/ja'
import { isValidDateStr } from '../lib/date'

export function displayInputDate(value: string): string {
  return isValidDateStr(value) ? format(parseISO(value), 'yyyy/MM/dd (E)', { locale: ja }) : value
}

export function readInputDate(text: string, min?: string, max?: string): { value: string | null; error: string } {
  const input = text.normalize('NFKC').trim()
  if (!input) return { value: '', error: '' }
  const parts = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(input) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(input)
  const value = parts ? `${parts[1]}-${parts[2].padStart(2, '0')}-${parts[3].padStart(2, '0')}` : ''
  if (!parts || Number(parts[1]) === 0 || !isValidDateStr(value)) return { value: null, error: '日付をYYYY/MM/DDまたはYYYYMMDDで入力してください。' }
  if (min && value < min) return { value: null, error: `${displayInputDate(min)}以降の日付を指定してください。` }
  if (max && value > max) return { value: null, error: `${displayInputDate(max)}以前の日付を指定してください。` }
  return { value, error: '' }
}
