import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { type CashFlowPeriod, type ModelConfig, reproject } from '../src/index.js'

const notebook = readFileSync('examples/observable/fund-pacing.html', 'utf8')
const cell = notebook.match(/<script id="31"[^>]*>([\s\S]*?)<\/script>/)?.[1]
const config: ModelConfig = {
  fund_life: 3,
  periodsPerYear: 1,
  growthRate: 0,
  yieldRate: 0,
  bowFactor: 2,
  callSchedule: { basis: 'commitment', rates: [0.25, 0.25, 0.5] },
  distributionSchedule: { basis: 'nav', rates: [0, 0, 0] },
  terminalLiquidation: true,
}
const fund = { commitment: 5_000_000_000, startDate: '2024-01-15' }

function display(format: (row: CashFlowPeriod) => unknown, actualCall = 8) {
  if (!cell) throw new Error('Notebook calculation cell missing')
  return runInNewContext(`${cell}; ({ rows, summary })`, {
    config,
    fund,
    actualsText: `date,type,amount_m\n2024-05-15,call,${actualCall}`,
    fp: {
      reproject: (...args: Parameters<typeof reproject>) => {
        const result = reproject(...args)
        return {
          ...result,
          baseline: result.baseline.map(format),
          revised: result.revised.map(format),
        }
      },
    },
  }) as {
    rows: { calls: number; dist: number; planCalls: number }[]
    summary: Record<string, number>
  }
}

describe('Observable example consumes both output formats', () => {
  it.each(['legacy', 'current'])('renders %s flows and the correct historical cutoff', (mode) => {
    const result = display((row) => {
      if (mode === 'current') return row
      const { calledPeriod, distributedPeriod, ...rest } = row
      return { ...rest, called: calledPeriod, distributed: distributedPeriod }
    })
    expect(result.rows.map((row) => row.calls)).toEqual([8, 14, 28])
    expect(result.rows.map((row) => row.planCalls)).toEqual([12.5, 12.5, 25])
    expect(result.summary.lastHistorical).toBe(2024)
    expect(result.summary.planNext2).toBe(37.5)
    expect(result.summary.revNext2).toBe(42)
    expect(result.summary.distRev).toBe(50)
  })

  it('preserves explicit zero flows when both new and legacy names are present', () => {
    const result = display((row) => ({ ...row, called: 999, distributed: 999 }), 0)
    expect(result.rows[0]?.calls).toBe(0)
    expect(result.rows[0]?.dist).toBe(0)
  })
})
