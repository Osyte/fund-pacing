# Known issues and open conventions

Behaviour that is deliberate but undocumented elsewhere, or that has been identified as needing a decision before 1.0. Each open item is stable in the current release; none will change without a spec decision and a changelog entry. Resolved items are retained temporarily for release-triage traceability.

## Model conventions

### K1 — The bow curve is not frequency-adjusted

`yieldRate` and `growthRate` are converted from annual to per-period geometrically. The bow term `(t/T)^B` is not: it is applied once per period as written. The same fund therefore distributes materially faster at `periodsPerYear: 4` than at `periodsPerYear: 1`. For a 10-year fund fully called in year 1 with `bowFactor: 2.5`:

| | Annual | Quarterly |
|---|---|---|
| Distributed by year 5, as a share of commitment | 0.49 | 1.07 |
| NAV at year 5 | 1.21 | 0.58 |

Until this is settled, compare configurations only at the same frequency. See `src/engine/rates.ts`, `distributionAt`.

### K2 — Resolved: first calls can land in period 0

Period 0 is the first modeled cash-flow period containing `startDate`. `callSchedule.rates[0]` now applies in period 0, and output indices run from `0` through `termPeriods - 1`. There is no separate inception-only row.

### K3 — Resolved: commitment-basis forecasts rescale after actuals

Commitment-basis call schedules must sum to 100% of commitment. After actuals, `commitment`-basis forecast calls are rescaled across the remaining original forecast calls so cumulative called capital returns to 100% of commitment. If actual calls already exceed commitment, future commitment-basis calls are zero. `unfunded`-basis schedules continue to use actual remaining unfunded commitment.

### K4 — Resolved: call schedules must cover the full term

`callablePeriods` has been removed. `callSchedule.rates` must contain exactly `termPeriods` entries; periods with no calls must be represented by explicit `0` rates. Invalid lengths return `SCHEDULE_TOO_LONG` or `SCHEDULE_TOO_SHORT` from `validateConfig`, and engine entry points reject them.

### K5 — Transactions dated before `startDate` bucket into period 0

No issue is raised. These are usually data-entry errors and a validation warning is planned.

## Validation

### K6 — Resolved: `validateConfig` returns issues for structurally incomplete configs

`validateConfig(config: ModelConfig)` keeps its public signature but now defensively handles malformed runtime shapes, including missing or malformed schedules. It returns `{ ok: false, issues }` instead of leaking `TypeError`. Engine functions still throw `PacingConfigError` for invalid configs.

### K7 — The zod schemas are looser than `validateConfig` on dates

The schema checks the `YYYY-MM-DD` shape only, so an impossible date such as `2023-02-29` passes the schema and then throws `PacingInputError` in the engine. Treat the schema as a shape check and the engine as the authority.

## Output

### K8 — `baseline` and `revised` are the same array when there are no actuals

Both are typed `readonly`. Do not mutate either.

### K9 — `variance` covers only the baseline's length

When actuals extend the term (spec D5), the extended periods have no variance rows.
