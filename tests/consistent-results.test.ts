import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  buildSchedule,
  type ModelConfig,
  PacingInputError,
  project,
  reproject,
} from '../src/index.js'

const CONFIG: ModelConfig = {
  fund_life: 1,
  periodsPerYear: 4,
  growthRate: 0,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.25, 0.25] },
  distributionSchedule: { basis: 'nav', rates: [0, 0.5, 0.5, 0.5] },
  terminalLiquidation: false,
}
const FUND = { commitment: 10_000, startDate: '2024-01-15' }
const shared = [
  'index',
  'calledPeriod',
  'distributedPeriod',
  'calledCumulative',
  'distributedCumulative',
  'unfunded',
  'nav',
  'dpi',
  'rvpi',
  'tvpi',
]

describe('consistent public results (issue #29)', () => {
  it('uses the agreed shared names and removes legacy output names', () => {
    const schedule = buildSchedule(CONFIG)
    const result = reproject(CONFIG, FUND, [{ date: '2024-05-15', type: 'call', amount: 1000 }])
    for (const row of schedule) expect(Object.keys(row).sort()).toEqual([...shared].sort())
    for (const row of [...project(CONFIG, FUND), ...result.baseline, ...result.revised]) {
      expect(Object.keys(row).sort()).toEqual(
        [...shared, 'periodEnd', 'source', 'netCashFlow', 'overcalled'].sort(),
      )
      expect(row.netCashFlow).toBe(row.distributedPeriod - row.calledPeriod)
    }
    expect(result.asOf).toBe('2024-06-30')
    expect(result.revised[1]).toMatchObject({ calledPeriod: 1000, source: 'forecast' })
    expect(result.variance[1]?.calledDelta).toBe(-1500)
  })

  it('expresses unfunded-basis calls as fractions of total commitment in the worked example', () => {
    const config: ModelConfig = {
      ...CONFIG,
      fund_life: 10,
      periodsPerYear: 1,
      callSchedule: { basis: 'unfunded', rates: [0.25, 0.3, 0.35, 0.5, 0.5, 0.5, 0, 0, 0, 0] },
      distributionSchedule: { basis: 'nav', rates: Array(10).fill(0) },
    }
    const before = JSON.stringify(config)
    const rows = buildSchedule(config)
    const expected = [0.25, 0.225, 0.18375, 0.170625, 0.0853125, 0.04265625, 0, 0, 0, 0]
    rows.forEach((row, i) => {
      expect(row.calledPeriod).toBeCloseTo(expected[i] ?? NaN, 14)
    })
    expect(rows[1]?.calledCumulative).toBeCloseTo(0.475, 14)
    expect(rows[1]?.unfunded).toBeCloseTo(0.525, 14)
    expect(rows.at(-1)?.calledCumulative).toBeCloseTo(0.95734375, 14)
    expect(project(config, FUND)[1]?.calledPeriod).toBe(2250)
    expect(JSON.stringify(config)).toBe(before)
  })

  it('reports NAV-based distribution amounts rather than the applied rates', () => {
    const rows = buildSchedule(CONFIG)
    expect(rows.map((row) => row.distributedPeriod)).toEqual([0, 0.125, 0.1875, 0.21875])
    expect(rows[1]).toMatchObject({
      calledPeriod: 0.25,
      calledCumulative: 0.5,
      distributedCumulative: 0.125,
      nav: 0.375,
      dpi: 0.25,
      rvpi: 0.75,
      tvpi: 1,
    })
  })

  it('includes distribution caps and terminal liquidation in normalized period flows', () => {
    const capped = buildSchedule({
      ...CONFIG,
      distributionSchedule: { basis: 'commitment', rates: [0.8, 0.2] },
    })
    expect(capped[0]?.distributedPeriod).toBe(0.25)
    expect(capped[0]?.nav).toBe(0)
    const liquidated = buildSchedule({
      ...CONFIG,
      distributionSchedule: { basis: 'nav', rates: [0, 0, 0, 0] },
      terminalLiquidation: true,
    })
    expect(liquidated.at(-1)).toMatchObject({
      distributedPeriod: 1,
      distributedCumulative: 1,
      nav: 0,
      dpi: 1,
      rvpi: 0,
      tvpi: 1,
    })
  })

  it('returns zero multiples before any capital is called', () => {
    const rows = buildSchedule({
      ...CONFIG,
      callSchedule: { basis: 'unfunded', rates: [0, 0, 0, 0] },
    })
    expect(rows.every((row) => row.dpi === 0 && row.rvpi === 0 && row.tvpi === 0)).toBe(true)
    expect(JSON.parse(JSON.stringify(rows))).toEqual(rows)
  })

  it('keeps monetary allocation exact rather than deriving rounded money from fractions', () => {
    const config: ModelConfig = {
      ...CONFIG,
      fund_life: 1.25,
      callSchedule: { basis: 'commitment', rates: [0.2, 0.2, 0.2, 0.2, 0.2] },
    }
    const rows = project(config, { ...FUND, commitment: 3 })
    expect(rows.map((row) => row.calledPeriod)).toEqual([1, 1, 1, 0, 0])
    expect(rows.at(-1)?.calledCumulative).toBe(3)
    expect(buildSchedule(config)[0]?.calledPeriod).toBe(0.2)
  })

  it.each(['dpi', 'rvpi', 'tvpi'] as const)('rejects overflow in normalized %s', (multiple) => {
    const config: ModelConfig = {
      ...CONFIG,
      fund_life: 3,
      periodsPerYear: 1,
      callSchedule: { basis: 'unfunded', rates: [1e-300, 0, 0] },
      growthRate: multiple === 'tvpi' ? 1.8e154 : 1e160,
      distributionSchedule: {
        basis: 'nav',
        rates: multiple === 'tvpi' ? [0, 0.1, 0.5] : [0, 0, 0],
      },
      terminalLiquidation: multiple === 'dpi',
    }
    expect(() => buildSchedule(config)).toThrow(PacingInputError)
    expect(() => buildSchedule(config)).toThrow(
      expect.objectContaining({ code: 'NUMERIC_OVERFLOW' }),
    )
  })

  it('matches normalized schedules to investment forecasts across bases and periodicities', () => {
    fc.assert(
      fc.property(
        fc.record({
          frequency: fc.constantFrom(1 as const, 2 as const, 4 as const),
          callBasis: fc.constantFrom('commitment' as const, 'unfunded' as const),
          distributionBasis: fc.constantFrom('modeled', 'commitment', 'nav'),
          growth: fc.double({ min: -0.3, max: 0.15, noNaN: true }),
          yield: fc.constantFrom(0, 0.02),
          bow: fc.constantFrom(0.5, 2),
          terminalLiquidation: fc.boolean(),
        }),
        (input) => {
          const count = 3 * input.frequency
          const config: ModelConfig = {
            ...CONFIG,
            fund_life: 3,
            periodsPerYear: input.frequency,
            growthRate: input.growth,
            yieldRate: input.yield,
            bowFactor: input.bow,
            callSchedule: {
              basis: input.callBasis,
              rates:
                input.callBasis === 'commitment'
                  ? Array(count).fill(1 / count)
                  : Array.from(
                      { length: count },
                      (_, i) => [0.25, 0.3, 0.35, 0.5, 0.5, 0.5][i] ?? 0,
                    ),
            },
            terminalLiquidation: input.terminalLiquidation,
          }
          const { distributionSchedule: _override, ...modeled } = config
          const resolved: ModelConfig =
            input.distributionBasis === 'modeled'
              ? modeled
              : {
                  ...modeled,
                  distributionSchedule: {
                    basis: input.distributionBasis as 'nav' | 'commitment',
                    rates: Array(count).fill(
                      input.distributionBasis === 'nav' ? 0.25 : 0.5 / count,
                    ),
                  },
                }
          const commitment = 1_000_000_000_000
          const schedule = buildSchedule(resolved)
          const forecast = project(resolved, { ...FUND, commitment })
          for (const [i, curve] of schedule.entries()) {
            const row = forecast[i]
            if (!row) throw new Error('Missing forecast period')
            for (const field of [
              'calledPeriod',
              'distributedPeriod',
              'calledCumulative',
              'distributedCumulative',
              'nav',
              'unfunded',
            ] as const) {
              expect(row[field] / commitment).toBeCloseTo(curve[field], 7)
            }
            for (const field of ['dpi', 'rvpi', 'tvpi'] as const) {
              expect(row[field]).toBeCloseTo(curve[field], 7)
            }
          }
        },
      ),
      { numRuns: 200 },
    )
  })
})
