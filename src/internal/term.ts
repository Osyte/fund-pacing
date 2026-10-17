import type { ModelConfig } from '../types.js'

/** Config validation guarantees a positive, safe integer; never round fund life. */
export function termPeriodsFor(config: Pick<ModelConfig, 'fund_life' | 'periodsPerYear'>): number {
  return config.fund_life * config.periodsPerYear
}
