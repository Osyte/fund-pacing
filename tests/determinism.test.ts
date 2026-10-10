/**
 * Spec §5.7 — isomorphic determinism.
 *
 * This file runs under both the `node` and `jsdom` Vitest projects. The hashes
 * are computed from JSON output, so a divergence in either environment (a
 * timezone-sensitive date, a locale-sensitive format) fails the build.
 */

import { describe, expect, it } from 'vitest'
import { buildSchedule, type ModelConfig, project, reproject } from '../src/index.js'

const CONFIG: ModelConfig = {
  periodsPerYear: 4,
  termPeriods: 40,
  callablePeriods: 20,
  growthRate: 0.18,
  yieldRate: 0.02,
  bowFactor: 2.1,
  callSchedule: {
    basis: 'unfunded',
    rates: [0.25, 0.3, 0.4, 0.2, 0.15, 0.1, 0.1, 0.1],
  },
  terminalLiquidation: true,
  termExtensionYears: 3,
}

const FUND = { commitment: 25_000_000_00, startDate: '2021-02-11' }

const ACTUALS = [
  { date: '2021-03-31', type: 'call' as const, amount: 2_500_000_00 },
  { date: '2021-09-30', type: 'call' as const, amount: 3_000_000_00 },
  { date: '2022-06-30', type: 'distribution' as const, amount: 1_200_000_00 },
  { date: '2022-06-30', type: 'nav' as const, amount: 6_800_000_00 },
]

describe('cross-environment determinism', () => {
  it('buildSchedule output is stable', () => {
    expect(JSON.stringify(buildSchedule(CONFIG))).toMatchSnapshot()
  })

  it('project output is stable', () => {
    expect(JSON.stringify(project(CONFIG, FUND))).toMatchSnapshot()
  })

  it('reproject output is stable', () => {
    expect(JSON.stringify(reproject(CONFIG, FUND, ACTUALS))).toMatchSnapshot()
  })

  it('is JSON round-trippable with no loss', () => {
    const result = reproject(CONFIG, FUND, ACTUALS)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
