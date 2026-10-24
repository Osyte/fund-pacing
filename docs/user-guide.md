# User guide

[Installation](installation.md) · [Configuration](configuration.md) · [Results](results.md)

Choose the function that matches your purpose. They are independent entry points;
you do not need to call `buildSchedule` before projecting an investment, or
`validateConfig` before using an engine function. Engine functions validate their
inputs automatically. `validateConfig` is useful when you want to display issues
without handling an exception.

| Purpose | Function | Inputs |
|---|---|---|
| Explore curves and the impact of assumptions | `buildSchedule` | Config |
| Forecast a prospective or new investment | `project` | Config and fund terms |
| Update a forecast using investment history | `reproject` | Config, fund terms, and transactions |
| Reuse validation rules in your application | `validateConfig` | Config |

For an interactive walkthrough, open the
[fund-pacing notebook](https://observablehq.com/@dentrassi/osyte-fund-pacing).
It demonstrates configuration validation, an original forecast, and reprojection
with editable assumptions, transaction history, charts, and a variance table.
The notebook imports a published library version; changes on a local branch
appear there only after a new release and a notebook update. Its
[source and maintenance instructions](https://github.com/Osyte/fund-pacing/tree/main/examples/observable)
are kept in the repository. Observable is optional demonstration tooling; the
library runs independently of it.

## Example setup

Examples on this page share the following setup. These are illustrative
assumptions, not investment recommendations or library defaults. Read the
[configuration guide](configuration.md) before adapting them.

```ts
import {
  buildSchedule,
  project,
  reproject,
  validateConfig,
  type ModelConfig,
  type Transaction,
} from '@osyte/fund-pacing'

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

const fund = {
  commitment: 1_000_000_000, // $10 million in cents
  startDate: '2024-01-15',
}
```

## Explore curves and assumptions

Use `buildSchedule` when you want to compare model assumptions before specifying
an investment's size and start date. It returns fractional curve data that your
application can plot or analyze; the core does not render a chart.

```ts
const curve = buildSchedule(config)
const earlierDistributions = buildSchedule({ ...config, bowFactor: 1.5 })
const laterDistributions = buildSchedule({ ...config, bowFactor: 3 })

console.log(curve.length) // 16
console.log(curve[0]?.calledFraction) // 0.25
```

All three calls use the same quarterly frequency. You can similarly compare
growth or yield assumptions by creating new config objects. A lower bow factor
raises the bow rate before term end; yield can set a higher rate floor. Changing
frequency requires a new call-schedule length and bow calibration, as explained
under [periodicity](configuration.md#periodicity-affects-the-model).

The output includes period index, call/distribution rates, cumulative called and
distributed fractions, NAV fraction, and unfunded fraction. It has no calendar
dates or currency amounts. See [curve results](results.md#curve-results).

## Forecast a prospective or new investment

Use `project` when the investment has no actual history to incorporate. Supply
the intended commitment and start date along with your config.

```ts
const forecast = project(config, fund)

console.log(forecast.length) // 16
console.log(forecast[0]?.periodEnd) // '2024-03-31'
console.log(forecast[0]?.called) // 250000000 cents ($2.5 million)
console.log(forecast[0]?.source) // 'forecast'
console.log(forecast.at(-1)?.nav) // 0 with this terminal-liquidation setting
```

Period 0 is the calendar period containing `startDate`, and consumes
`callSchedule.rates[0]`. Every row contains dated money amounts and investment
multiples. `project` calculates directly; it does not require a previous
`buildSchedule` result.

## Update an investment with history

Use `reproject` for an investment with observed capital calls, distributions, or
NAV. Each transaction has an ISO date, a type, and a non-negative integer amount
in minor units. The transaction type carries the direction; zero is valid.

```ts
const actuals = [
  { date: '2024-03-31', type: 'call', amount: 200_000_000 },
  { date: '2024-06-30', type: 'call', amount: 150_000_000 },
  { date: '2024-06-30', type: 'distribution', amount: 20_000_000 },
  { date: '2024-06-30', type: 'nav', amount: 360_000_000 },
] satisfies Transaction[]

const result = reproject(config, fund, actuals)

console.log(result.asOf) // '2024-06-30'
console.log(result.revised[1]?.nav) // 360000000: the reported NAV
console.log(result.revised[2]?.source) // 'forecast'
console.log(result.revised[2]?.called) // 325000000 cents ($3.25 million)
```

The result contains:

- `baseline`: the original forecast without actuals.
- `revised`: historical periods followed by the updated forecast.
- `variance`: revised-minus-baseline differences over their shared periods.
- `asOf`: the end of the latest period containing supplied transactions, or `null` with no actuals.

### How transactions become historical periods

Calls and distributions are summed into their calendar periods. For NAV, the
latest observation by date wins; equal-date ties use the last input entry.
Transactions can arrive out of chronological order. The latest transaction of
**any type** determines the actual boundary, including a zero-amount transaction.

All periods through that boundary use supplied calls and distributions, with
missing amounts treated as zero. Forecast calls and distributions resume at the
next fund-age period from the resulting NAV and called capital; the schedule
does not restart at index 0.
`asOf` is the period end, not necessarily the latest transaction date.
For example, a May 15 transaction enters the June 30 quarterly row. That whole
quarter is closed as history; forecast cash flows resume in the September 30 row. The
engine does not forecast a remainder of the quarter or prorate its rates.

### Missing actual inputs

Any subset of transaction types is accepted. Within the historical horizon:

| Missing input | Behavior |
|---|---|
| Capital calls | Zero calls; forecast calls are not substituted. |
| Distributions | Zero distributions; forecast distributions are not substituted. |
| NAV | Modeled from grown prior NAV plus supplied calls minus supplied distributions, floored at zero. |

A supplied NAV of zero overrides modeled NAV. A NAV-only history does not imply
earlier paid-in capital.

A historical row is `source: 'actual'` only when NAV was supplied for that
period, including zero. Whenever NAV is modeled, the whole row is
`source: 'forecast'`, including gaps in history. Supplied calls and distributions
remain unchanged in those rows; the label does not replace them with forecasts
or reopen the period. A forecast row can therefore appear before a later actual
row. Use `asOf` to locate the transaction cutoff, rather than the first forecast
row or the last actual row.

For example, a May 15 call without a NAV observation appears in the June 30 row
with `source: 'forecast'`. Its call amount is preserved, `asOf` is June 30, and
forecast calls and distributions resume in September.

With omitted or empty actuals, the revised values equal `project(config, fund)`
and `asOf` is `null`.

### Forecast calls after actuals

For a commitment-basis schedule, remaining positive forecast calls are rescaled
to the remaining commitment. In the example, the investment has called $3.5m
instead of the original $5m by the end of Q2. The remaining two equal-weight call
periods each call $3.25m, bringing total calls to $10m.

Zero-weight periods stay zero. If no positive scheduled calls remain, the
engine does not invent a new call period; total calls may remain below commitment.
If actual calls exceed commitment, they are preserved, unfunded becomes negative,
and future commitment calls are zero. Unfunded-basis schedules instead apply
their rates to actual remaining unfunded, floored at zero for future calls.

### Add, edit, or delete history

Pass the **complete current transaction history** on every call, not just changes
since the previous call. The library stores no history between calls. Your
application owns persistence and can recompute after an add, edit, or deletion.

For example, create an updated history in your application and pass that list to
`reproject` again. The original baseline still comes from the supplied config
and fund terms; changing those assumptions also changes that baseline.

### Pre-start transactions

Transactions before `startDate` enter period 0 rather than being discarded. The
engine has no warning output. A consuming application should flag these dates
for review using validated ISO date strings:

```ts
const preStartTransactions = actuals.filter(tx => tx.date < fund.startDate)
// Display a warning in your application when this list is nonempty.
```

These transactions follow the same summation and latest-NAV rules. They can make
period 0 actual. See [K5](known_issues.md#k5--accepted-pre-start-transactions-bucket-into-period-0).

### Actuals beyond the original term

Only actuals beyond the original term trigger `termExtensionYears`:

This optional field defaults to `0`. With no extension setting, late actuals
still appear in `revised`, but no future periods are added after the last
transaction period. The example config explicitly sets three extra years:

```ts
const extended = reproject(config, fund, [
  { date: '2028-03-31', type: 'nav', amount: 400_000_000 },
])

console.log(extended.baseline.length) // 16
console.log(extended.revised.length) // 29: 17 historical periods + 12 future periods
console.log(extended.variance.length) // 16
```

The baseline ends at the original horizon. Extra revised periods have no
variance rows. The complete-history rule still applies: this NAV-only example
supplies no historical calls, so historical called capital is zero.

## Reuse validation rules in your application

Use `validateConfig` in a parameter form or before saving config so users can
see the library's structured issues. This avoids implementing a separate set
of model rules that can drift from the calculation engine.

```ts
const validation = validateConfig({ ...config, fund_life: 0 })

if (!validation.ok) {
  console.log(validation.issues[0]?.path) // 'fund_life'
  console.log(validation.issues[0]?.code) // 'INVALID_FUND_LIFE'
}
```

It checks config only, not fund terms or transaction dates. Engine functions
also validate their own inputs and throw on invalid input. See
[validation and errors](validation.md) for error handling and optional schemas.
