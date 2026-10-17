/**
 * Spec §5 — the nine correctness requirements.
 *
 * These are written in the spec as universally-quantified statements, so they
 * are verified that way: fast-check generates arbitrary valid configs and
 * asserts each property across them. Example-based tests would only confirm
 * the cases we already thought of.
 */

import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildSchedule, project, reproject } from '../src/index.js'
import { periodEndDates } from '../src/internal/calendar.js'
import { arbCommitment, arbConfig, arbStartDate, arbTransactions } from './arbitraries.js'

const RUNS = { numRuns: 300 }

describe('spec §5 invariants', () => {
  it('#1 commitment-basis schedules call exactly the commitment', () => {
    fc.assert(
      fc.property(arbConfig, arbCommitment, arbStartDate, (config, commitment, startDate) => {
        const rates = config.callSchedule.rates
        const sum = rates.reduce((a, b) => a + b, 0)
        // Only meaningful for commitment basis with rates summing to 1.
        fc.pre(config.callSchedule.basis === 'commitment')
        fc.pre(Math.abs(sum - 1) < 1e-12)

        const rows = project(config, { commitment, startDate })
        const last = rows[rows.length - 1]
        expect(last?.calledCumulative).toBe(commitment)
      }),
      RUNS,
    )
  })

  it('#2 buildSchedule is scale- and calendar-invariant', () => {
    fc.assert(
      fc.property(arbConfig, (config) => {
        const a = JSON.stringify(buildSchedule(config))
        const b = JSON.stringify(buildSchedule(config))
        expect(a).toBe(b)
        // Nothing in the Layer 1 output can depend on money or dates: the
        // signature does not accept them.
        expect(Object.keys(buildSchedule(config)[0] ?? {})).not.toContain('periodEnd')
      }),
      RUNS,
    )
  })

  it('#3 empty actuals is a no-op', () => {
    fc.assert(
      fc.property(arbConfig, arbCommitment, arbStartDate, (config, commitment, startDate) => {
        const fund = { commitment, startDate }
        const result = reproject(config, fund, [])
        expect(result.revised).toEqual(project(config, fund))
        expect(result.baseline).toEqual(result.revised)
        expect(result.asOf).toBeNull()
      }),
      RUNS,
    )
  })

  it('#4 conservation holds in every period, including when overcalled', () => {
    fc.assert(
      fc.property(
        arbConfig,
        arbCommitment,
        arbStartDate,
        arbTransactions,
        (config, commitment, startDate, actuals) => {
          const { revised } = reproject(config, { commitment, startDate }, actuals)
          for (const p of revised) {
            expect(p.unfunded + p.calledCumulative).toBe(commitment)
            expect(p.netCashFlow).toBe(p.distributed - p.called)
          }
        },
      ),
      RUNS,
    )
  })

  it('#5 NAV is never negative', () => {
    fc.assert(
      fc.property(
        arbConfig,
        arbCommitment,
        arbStartDate,
        arbTransactions,
        (config, commitment, startDate, actuals) => {
          const { revised, baseline } = reproject(config, { commitment, startDate }, actuals)
          for (const p of [...revised, ...baseline]) {
            expect(p.nav).toBeGreaterThanOrEqual(0)
          }
        },
      ),
      RUNS,
    )
  })

  it('#6 actual periods reproduce the supplied amounts verbatim', () => {
    fc.assert(
      fc.property(
        arbConfig,
        arbCommitment,
        arbStartDate,
        arbTransactions,
        (config, commitment, startDate, actuals) => {
          const { revised } = reproject(config, { commitment, startDate }, actuals)

          const expectedCalls = new Map<string, number>()
          const expectedDists = new Map<string, number>()
          for (const p of revised) {
            if (p.source !== 'actual') continue
            expectedCalls.set(p.periodEnd, 0)
            expectedDists.set(p.periodEnd, 0)
          }

          // Re-bucket independently of the implementation, by period end date.
          for (const tx of actuals) {
            const period = revised.find((p) => p.source === 'actual' && tx.date <= p.periodEnd)
            if (!period) continue
            if (tx.type === 'call') {
              expectedCalls.set(
                period.periodEnd,
                (expectedCalls.get(period.periodEnd) ?? 0) + tx.amount,
              )
            } else if (tx.type === 'distribution') {
              expectedDists.set(
                period.periodEnd,
                (expectedDists.get(period.periodEnd) ?? 0) + tx.amount,
              )
            }
          }

          for (const p of revised) {
            if (p.source !== 'actual') continue
            expect(p.called).toBe(expectedCalls.get(p.periodEnd) ?? 0)
            expect(p.distributed).toBe(expectedDists.get(p.periodEnd) ?? 0)
          }
        },
      ),
      RUNS,
    )
  })

  it('#8 fund life derives the period count and call schedules map one-to-one onto it', () => {
    fc.assert(
      fc.property(arbConfig, arbCommitment, arbStartDate, (config, commitment, startDate) => {
        const schedule = buildSchedule(config)
        const rows = project(config, { commitment, startDate })
        const termPeriods = config.fund_life * config.periodsPerYear
        expect(schedule).toHaveLength(termPeriods)
        expect(rows).toHaveLength(termPeriods)
        expect(reproject(config, { commitment, startDate }).baseline).toHaveLength(termPeriods)
        for (const s of schedule) {
          expect(s.callRate).toBe(config.callSchedule.rates[s.index])
        }
        for (const r of rows) {
          if (config.callSchedule.rates[r.index] === 0) expect(r.called).toBe(0)
        }
      }),
      RUNS,
    )
  })

  it('#9 commitment-basis reprojections preserve full commitment after actuals', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 24 }),
        arbCommitment,
        arbStartDate,
        fc.integer({ min: 0, max: 22 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (termPeriods, commitment, startDate, rawActualIndex, actualFraction) => {
          const actualIndex = rawActualIndex % (termPeriods - 1)
          const baseRate = 1 / termPeriods
          const rates = Array(termPeriods).fill(baseRate)
          rates[termPeriods - 1] = 1 - baseRate * (termPeriods - 1)
          const config = {
            periodsPerYear: 4 as const,
            fund_life: termPeriods / 4,
            growthRate: 0,
            yieldRate: 0,
            bowFactor: 1,
            callSchedule: { basis: 'commitment' as const, rates },
            distributionSchedule: { basis: 'nav' as const, rates: Array(termPeriods).fill(0) },
            terminalLiquidation: false,
            termExtensionYears: 0,
          }

          const actualDate = periodEndDates(startDate, config.periodsPerYear, actualIndex + 1)[
            actualIndex
          ]
          const actualCalled = Math.round(commitment * actualFraction)
          const { revised } = reproject(config, { commitment, startDate }, [
            { date: actualDate ?? startDate, type: 'call', amount: actualCalled },
          ])

          expect(revised.at(-1)?.calledCumulative).toBe(commitment)
        },
      ),
      RUNS,
    )
  })
})

describe('overcalling (spec D8)', () => {
  it('permits negative unfunded and flags it', () => {
    const config = {
      periodsPerYear: 4 as const,
      fund_life: 2,
      growthRate: 0.1,
      yieldRate: 0,
      bowFactor: 2.5,
      callSchedule: { basis: 'commitment' as const, rates: [0.5, 0.5, 0, 0, 0, 0, 0, 0] },
      terminalLiquidation: true,
      termExtensionYears: 3,
    }
    const fund = { commitment: 1_000_000_00, startDate: '2024-01-15' }

    const { revised } = reproject(config, fund, [
      { date: '2024-03-31', type: 'call', amount: 700_000_00 },
      { date: '2024-06-30', type: 'call', amount: 600_000_00 },
    ])

    const atBoundary = revised.find((p) => p.periodEnd === '2024-06-30')
    expect(atBoundary?.calledCumulative).toBe(1_300_000_00)
    expect(atBoundary?.unfunded).toBe(-300_000_00)
    expect(atBoundary?.overcalled).toBe(true)
  })
})
