/**
 * Civil-date arithmetic on `YYYY-MM-DD` strings.
 *
 * This module never constructs a `Date`. `new Date('2025-03-31')` parses as
 * UTC while `getFullYear()` reads local time, which silently shifts the date
 * by a day for anyone west of UTC — a determinism bug that reproduces only in
 * some timezones. Integers in, integers out.
 */

import { PacingInputError } from '../errors.js'
import type { Frequency } from '../types.js'

export interface CivilDate {
  readonly y: number
  readonly m: number // 1-12
  readonly d: number // 1-31
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLeapYear(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31
}

export function parseISO(value: string, path = 'date'): CivilDate {
  const match = ISO.exec(value)
  if (!match) {
    throw new PacingInputError('INVALID_DATE', path, `expected YYYY-MM-DD, received "${value}"`)
  }
  const y = Number(match[1])
  const m = Number(match[2])
  const d = Number(match[3])
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
    throw new PacingInputError('INVALID_DATE', path, `"${value}" is not a real calendar date`)
  }
  return { y, m, d }
}

export function formatISO(date: CivilDate): string {
  const m = String(date.m).padStart(2, '0')
  const d = String(date.d).padStart(2, '0')
  return `${String(date.y).padStart(4, '0')}-${m}-${d}`
}

/** Total ordering on civil dates. Negative when `a` precedes `b`. */
export function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

const MONTHS_PER_PERIOD: Record<Frequency, number> = { 1: 12, 2: 6, 4: 3 }

/**
 * Period-end dates for indices 0..count-1.
 *
 * Index 0 is the period containing `startDate`; each subsequent index advances
 * one period. Every date returned is the last day of its month.
 */
export function periodEndDates(
  startDate: string,
  periodsPerYear: Frequency,
  count: number,
): string[] {
  const { y, m } = parseISO(startDate, 'startDate')
  const step = MONTHS_PER_PERIOD[periodsPerYear]

  // Final calendar month of the period containing startDate.
  const anchorMonth = Math.ceil(m / step) * step
  const anchor = y * 12 + (anchorMonth - 1)

  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const total = anchor + i * step
    const yy = Math.floor(total / 12)
    const mm = (total % 12) + 1
    out.push(formatISO({ y: yy, m: mm, d: daysInMonth(yy, mm) }))
  }
  return out
}

/**
 * Period index containing `date`, relative to `startDate`.
 *
 * Computed arithmetically rather than by scanning a date list, so a
 * transaction beyond the modelled term still yields a usable index — which is
 * what drives term extension in `reproject`. Dates before the fund start
 * bucket to period 0.
 */
export function periodIndexOf(
  date: string,
  startDate: string,
  periodsPerYear: Frequency,
  path = 'date',
): number {
  const d = parseISO(date, path)
  const s = parseISO(startDate, 'startDate')
  const step = MONTHS_PER_PERIOD[periodsPerYear]

  const anchor = s.y * 12 + (Math.ceil(s.m / step) * step - 1)
  const target = d.y * 12 + (Math.ceil(d.m / step) * step - 1)

  return Math.max(0, Math.floor((target - anchor) / step))
}
