import { describe, expect, it } from 'vitest'
import {
  daysInMonth,
  isLeapYear,
  parseISO,
  periodEndDates,
  periodIndexOf,
} from '../src/internal/calendar.js'
import { allocate, roundMinor } from '../src/internal/money.js'

describe('calendar', () => {
  it('handles leap years', () => {
    expect(isLeapYear(2024)).toBe(true)
    expect(isLeapYear(1900)).toBe(false)
    expect(isLeapYear(2000)).toBe(true)
    expect(daysInMonth(2024, 2)).toBe(29)
    expect(daysInMonth(2023, 2)).toBe(28)
  })

  it('rejects malformed and impossible dates', () => {
    expect(() => parseISO('2024-2-01')).toThrow(/YYYY-MM-DD/)
    expect(() => parseISO('2023-02-29')).toThrow(/not a real calendar date/)
    expect(() => parseISO('2024-13-01')).toThrow()
  })

  it('produces quarter ends from any start date in the quarter', () => {
    for (const start of ['2024-01-01', '2024-02-14', '2024-03-31']) {
      expect(periodEndDates(start, 4, 3)).toEqual(['2024-03-31', '2024-06-30', '2024-09-30'])
    }
  })

  it('produces half-year and year ends', () => {
    expect(periodEndDates('2024-02-14', 2, 3)).toEqual(['2024-06-30', '2024-12-31', '2025-06-30'])
    expect(periodEndDates('2024-02-14', 1, 3)).toEqual(['2024-12-31', '2025-12-31', '2026-12-31'])
  })

  it('crosses February in leap and non-leap years', () => {
    expect(periodEndDates('2023-12-01', 4, 2)).toEqual(['2023-12-31', '2024-03-31'])
    expect(periodEndDates('2024-02-01', 1, 1)).toEqual(['2024-12-31'])
  })

  it('buckets transactions to periods, clamping dates before the start', () => {
    expect(periodIndexOf('2024-03-31', '2024-01-15', 4)).toBe(0)
    expect(periodIndexOf('2024-04-01', '2024-01-15', 4)).toBe(1)
    expect(periodIndexOf('2025-01-01', '2024-01-15', 4)).toBe(4)
    expect(periodIndexOf('2020-01-01', '2024-01-15', 4)).toBe(0)
  })

  it('never constructs a Date, so results do not vary with timezone', () => {
    const original = process.env.TZ
    const results: string[][] = []
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz
      results.push(periodEndDates('2024-01-01', 4, 4))
    }
    if (original === undefined) delete process.env.TZ
    else process.env.TZ = original
    expect(results[0]).toEqual(results[1])
    expect(results[1]).toEqual(results[2])
  })
})

describe('money', () => {
  it('rounds half away from zero', () => {
    expect(roundMinor(0.5)).toBe(1)
    expect(roundMinor(-0.5)).toBe(-1)
    expect(roundMinor(1.5)).toBe(2)
    expect(roundMinor(-1.5)).toBe(-2)
    expect(roundMinor(2.4)).toBe(2)
  })

  it('allocates so parts sum to the total exactly', () => {
    const parts = allocate(100, [1, 1, 1])
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100)
    expect(allocate(0, [1, 2]).reduce((a, b) => a + b, 0)).toBe(0)
    expect(allocate(10, [0, 0])).toEqual([0, 0])
  })
})
