# Known issues and accepted v0.x conventions

K1, K5, K7, K8, and K9 are accepted conventions for the initial/pre-1.0 release,
as tracked in [release triage #4](https://github.com/Osyte/fund-pacing/issues/4)
and [documentation issue #11](https://github.com/Osyte/fund-pacing/issues/11).
They are deterministic behavior, not unresolved release blockers. Future changes
require a spec decision and changelog entry. Resolved blockers are retained for
traceability.

| Item | v0.x disposition | Spec decision | Regression coverage |
|---|---|---|---|
| K1 | Accept frequency-specific bow calibration | D13 | `tests/conventions.test.ts` |
| K5 | Keep pre-start activity in period 0; applications flag it | D14 | `tests/conventions.test.ts`, `tests/calendar.test.ts` |
| K7 | Keep date schemas shape-focused; engine validates calendar dates | D15 | `tests/conventions.test.ts` |
| K8 | Accept sharing readonly arrays with empty actuals | D16 | `tests/conventions.test.ts` |
| K9 | Limit variance to the baseline horizon | D17 | `tests/fund-life.test.ts` |

The separate fund-life input change is recorded in D12: `fund_life` replaces
`termPeriods`, and period count is derived internally.

## Model conventions

### K1 — Accepted: bow is calibrated to the selected frequency

`yieldRate` and `growthRate` convert from annual to per-period geometrically.
The bow term `((index + 1) / effectiveTermPeriods)^bowFactor` is applied once per
model period without frequency normalization. Supported frequencies are annual,
semiannual, and quarterly (`periodsPerYear: 1 | 2 | 4`).

The same bow factor therefore does not promise the same cash flows when frequency
changes: more frequent periods apply distributions more often. For v0.x, calibrate
bow for the selected frequency and compare curves at the same frequency. An
explicit `distributionSchedule` overrides both bow and yield. See spec D13 and
`src/engine/rates.ts`, `distributionAt`.

For example, use a four-year fund starting `2024-01-15`, a commitment of 10,000
minor units ($100), zero growth and yield, `bowFactor: 2`, no explicit
distribution schedule, and `terminalLiquidation: false`. Call the full commitment
in period 0 with zero call rates afterwards. At the end of year two:

| Frequency | Total model periods | Bow rate in the year-two closing period | Cumulative distributions |
|---|---|---|---|
| Annual | 4 | 25% | $25.00 |
| Semiannual | 8 | 25% | $39.57 |
| Quarterly | 16 | 25% | $58.13 |

The matching rate at one point does not undo distributions applied in earlier
periods. Reusing a bow value across frequencies therefore changes the result.

**Post-v0.1 question:** whether to introduce a frequency-independent curve and
how existing calibrated configurations would migrate.

### K2 — Resolved: first calls can land in period 0

Period 0 is the first modeled cash-flow period containing `startDate`. `callSchedule.rates[0]` now applies in period 0, and output indices run from `0` through `(fund_life * periodsPerYear) - 1`. There is no separate inception-only row.

### K3 — Resolved: commitment-basis forecasts rescale after actuals

Commitment-basis call schedules must sum to 100% of commitment. After actuals,
remaining positive forecast calls are rescaled to remaining commitment. If the
remaining schedule has no positive call weights, future calls stay zero: the
engine does not invent call periods to catch up. If actual calls already exceed
commitment, future commitment-basis calls are zero. `unfunded`-basis schedules
continue to use actual remaining unfunded commitment, floored at zero for future
calls. See spec D11.

### K4 — Resolved: call schedules must cover the full term

`callablePeriods` has been removed. `callSchedule.rates` must contain exactly `fund_life * periodsPerYear` entries; periods with no calls must be represented by explicit `0` rates. Invalid lengths return `SCHEDULE_TOO_LONG` or `SCHEDULE_TOO_SHORT` from `validateConfig`, and engine entry points reject them.

### K5 — Accepted: pre-start transactions bucket into period 0

Transactions dated before `startDate` enter period 0 rather than being rejected
or discarded. They follow normal bucket rules: calls and distributions sum;
the latest NAV by date wins, with input order breaking equal-date ties. If these
are the only actuals, `asOf` is the end of period 0, which is marked actual.

The current engine returns no warnings and performs no logging. The consuming
application should flag `transaction.date < fund.startDate` for review, using
validated ISO date strings. See the [user-guide example](user-guide.md#pre-start-transactions)
and spec D14.

**Post-v0.1 question:** whether the library needs a structured diagnostics API
for warnings, while preserving pure calculation entry points.

## Validation

### K6 — Resolved: `validateConfig` returns issues for structurally incomplete configs

`validateConfig(config: ModelConfig)` keeps its public signature but now defensively handles malformed runtime shapes, including missing or malformed schedules. It returns `{ ok: false, issues }` instead of leaking `TypeError`. Engine functions still throw `PacingConfigError` for invalid configs.

### K7 — Accepted: date schemas check shape; engine checks calendar validity

`FundTermsSchema` and the transaction schemas check the `YYYY-MM-DD` date shape.
An impossible date such as `2023-02-29` passes those checks, then engine entry
points reject it with `PacingInputError`, code `INVALID_DATE`. `validateConfig`
only checks model configuration; it does not receive or validate dates. Schema
success does not replace engine validation. See spec D15.

There is also a TypeScript boundary: inferred schema output permits an explicit
`undefined` for `distributionSchedule`. With `exactOptionalPropertyTypes` enabled,
omit that property when absent before treating parsed data as `ModelConfig`.
The core's optional property expects a schedule whenever the property is present.

**Post-v0.1 question:** whether to add semantic date checks and broader validation
parity to the optional schema entry point.

## Output

### K8 — Accepted: empty-actuals results may share the same readonly array

With omitted or empty actuals, `baseline` and `revised` currently share the same
array reference. Consumers must not depend on separate allocation or mutate
either result. Arrays and rows are typed readonly, not frozen at runtime; copy
both arrays and rows before editing. `asOf` is `null` and the variance rows have
zero deltas. See spec D16.

No change is planned for v0.x. There is no guarantee about reference identity
beyond the readonly contract, so consumers should compare values when needed.

### K9 — Accepted: variance covers only the baseline horizon

Variance is calculated as `revised - baseline` over their overlapping periods.
When actuals extend the term (spec D5), `baseline` retains its original
`fund_life * periodsPerYear` rows and `revised` may be longer. The extended periods
have no variance rows; their variance is undefined, not zero. See spec D17.

**Post-v0.1 question:** whether to support extended-horizon comparisons and what
reference forecast should supply a meaningful baseline for those periods.

For a one-year quarterly fund starting `2024-01-15` with
`termExtensionYears: 1`, an actual dated `2025-03-31` produces four baseline
periods, nine revised periods, and four variance rows. The five additional
revised periods have no baseline comparison.
