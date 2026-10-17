# Configuration

[Installation](installation.md) · [User guide](user-guide.md) · [Results](results.md)

## Why understanding config matters

`ModelConfig` defines the model assumptions used to create curves and project
cash flows. **Understand these inputs before interpreting or comparing results.**
Changing a rate's basis or the model frequency can materially change the forecast.

The same config is accepted by all four core functions. A config does not contain
investment size, start date, or history: `project` and `reproject` receive fund
terms separately, and `reproject` also receives transactions. `buildSchedule`
therefore lets you compare assumptions before selecting a particular investment.

## A complete config

```ts
import { type ModelConfig, validateConfig } from '@osyte/fund-pacing'

const config = {
  fund_life: 4,
  periodsPerYear: 4,
  growthRate: 0.15,
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: {
    basis: 'commitment',
    rates: [0.25, 0.25, 0.25, 0.25, ...Array(12).fill(0)],
  },
  terminalLiquidation: true,
  termExtensionYears: 3,
} satisfies ModelConfig

console.log(validateConfig(config)) // { ok: true }
```

Every field is required except `distributionSchedule`. The engine does not fill
in duration, growth, yield, bow, liquidation, or extension defaults.

## Field reference

| Field | How to enter it | Meaning |
|---|---|---|
| `fund_life` | Finite years > 0 | Original modeled duration. Multiplied by frequency, it must produce a positive safe integer period count. |
| `periodsPerYear` | `1`, `2`, or `4` | Annual, semiannual, or quarterly modeling. |
| `growthRate` | Finite annual decimal > -1 | Growth applied to prior NAV. Negative values and values above 1 are permitted. |
| `yieldRate` | Finite annual decimal >= 0 | Minimum modeled distribution rate after conversion to the selected period. |
| `bowFactor` | Finite number > 0 | Distribution curve shape, calibrated to the selected frequency. |
| `callSchedule` | `{ basis, rates }` | Per-period call rates; see schedule bases below. |
| `distributionSchedule` | Optional `{ basis, rates }` | Explicit distribution rates, replacing the bow/yield curve. |
| `terminalLiquidation` | `true` or `false` | Whether the final forecast period distributes all available assets. |
| `termExtensionYears` | Finite years >= 0 | Additional forecast duration after actuals outlive the original term. |

## Periodicity affects the model

The library derives the number of modeled periods as `fund_life * periodsPerYear`.
For a ten-year fund:

| `periodsPerYear` | Frequency | Derived periods and call-schedule entries |
|---|---|---|
| `1` | Annual | 10 |
| `2` | Semiannual | 20 |
| `4` | Quarterly | 40 |

Fractional years are allowed when they align with whole model periods: 2.5 years
quarterly produces 10 periods, and 0.5 years semiannually produces one period.
2.5 years annually is rejected. The engine does not round `fund_life` to a period.

Frequency also affects these inputs and outputs:

- **Call schedules:** each entry applies to one model period. A quarterly array
  cannot simply be reused as an annual array. Supply the intended rates at the
  chosen frequency; the library does not convert a schedule for you.
- **Calendar:** period ends are year ends, half-year ends, or quarter ends.
  Period 0 contains `startDate`. A partial starting calendar period is treated as
  a full step; growth and yield are not prorated.
- **Annual growth and yield:** enter annual rates. The engine converts each with
  `(1 + annual) ** (1 / periodsPerYear) - 1`. Do not divide them yourself.
- **Bow:** applied once per period without frequency normalization. Recalibrate
  bow when changing frequency; the same value can produce different cash flows.

See [K1's worked comparison](known_issues.md#k1--accepted-bow-is-calibrated-to-the-selected-frequency).

## Decimal rates and schedule bases

Enter 25% as `0.25`, not `25`. Schedule rates must each be in `[0, 1]`. Their
basis is explicit; it is never inferred from the values.

### Capital calls

| Basis | A rate of `0.25` means | Schedule rule |
|---|---|---|
| `commitment` | Call 25% of total commitment | Exactly one entry per derived period; rates must sum to 1 within `1e-9`. |
| `unfunded` | Call 25% of remaining uncalled commitment | Exactly one entry per derived period; rates need not sum to 1. |

Four 25% commitment calls call 100% of commitment. Four 25% unfunded calls call
about 68.36%. Choose the basis that matches the intended schedule.

Use explicit zeros for periods without calls. There is no `callablePeriods`
field. Monetary commitment calls are allocated with the rounding residual in
the final nonzero-weight period. After actuals, remaining commitment calls can
be rescaled; see [updating a forecast](user-guide.md#forecast-calls-after-actuals).

### Distributions

Without an explicit distribution schedule, the rate is the greater of converted
yield and the bow term `((index + 1) / effectiveTermPeriods) ** bowFactor`. It
applies to grown prior NAV, excluding the current period's call. A lower positive
bow factor gives a higher bow rate before the end of the term.

An explicit schedule overrides both bow and yield:

```ts
const customDistributions: ModelConfig = {
  ...config,
  distributionSchedule: {
    basis: 'nav',
    rates: [0, 0, 0, 0, ...Array(12).fill(0.1)],
  },
}
```

| Basis | A rate of `0.1` means |
|---|---|
| `commitment` | Distribute 10% of total commitment, capped at available assets. |
| `nav` | Distribute 10% of grown prior NAV, capped at available assets. |

Distribution schedule lengths are not constrained like call schedules. Missing
entries resolve to zero; entries beyond the modeled horizon are unused. Each
rate must be in `[0, 1]`, and commitment-basis distribution rates must sum to at
most 1, with a `1e-9` tolerance. There is no distribution catch-up rescaling.

`terminalLiquidation: true` overrides the distribution rate in the final
**forecast** period, distributing all available assets including that period's
call. It does not replace supplied actuals. Turning it off does not guarantee a
positive final NAV: a bow or explicit rate can still distribute all residual NAV.

## Extension years

`termExtensionYears` affects only `reproject`, when actuals extend beyond the
original term. The revised count becomes:

```text
lastActualIndex + 1 + Math.round(termExtensionYears * periodsPerYear)
```

Zero is valid and still includes the late actual period. Extension years retain
this rounding convention; unlike `fund_life`, they need not align exactly with
whole periods. Baseline and variance retain the original horizon.

## Migrating from termPeriods

Replace the previous period-count input with years:

```text
fund_life = termPeriods / periodsPerYear
```

For example, `{ termPeriods: 16, periodsPerYear: 4 }` becomes
`{ fund_life: 4, periodsPerYear: 4 }`. Keep the same schedule entries. Remove
`termPeriods`; it is not an alternative input. An equivalent duration preserves
the calculation results.

Use [validation](validation.md) to report invalid config to your users and the
[user guide](user-guide.md) to apply a valid config to an investment.
