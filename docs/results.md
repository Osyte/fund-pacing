# Understanding results

[User guide](user-guide.md) · [Configuration](configuration.md) · [Validation](validation.md)

All outputs are plain JSON-serializable data. The library computes values for
your application to inspect, store, format, or plot. It does not save results or
render charts through the core entry point.

## Curve results

`buildSchedule` returns one `SchedulePeriod` per derived model period. Values
are fractions, independent of a commitment amount and calendar start date.

| Field | Meaning |
|---|---|
| `index` | Zero-based period index. |
| `callRate` | Configured call rate for this period, with its configured basis. |
| `distributionRate` | Resolved distribution rate; terminal liquidation can override the amount distributed. |
| `calledFraction` | Cumulative called capital as a fraction of commitment. |
| `distributedFraction` | Cumulative distributions as a fraction of commitment. |
| `unfundedFraction` | Uncalled share of commitment. |
| `navFraction` | Closing NAV as a fraction of commitment. |

The called and distributed fractions are **cumulative**, not single-period flows.
Monetary projections use integer rounding, so scaling a fractional curve yourself
need not reproduce their amounts exactly. Use `project` when money is required.

## Investment cash-flow results

`project` returns `CashFlowPeriod` rows. `reproject` returns those same row types
in its `baseline` and `revised` arrays.

| Field | Meaning |
|---|---|
| `index` | Zero-based model period; period 0 contains `startDate`. |
| `periodEnd` | ISO calendar quarter-, half-year-, or year-end date. |
| `source` | `'actual'` when the period has reported NAV; `'forecast'` whenever NAV is modeled, including historical periods. |
| `called` | Capital called in the period, in minor units. |
| `distributed` | Distributions in the period, in minor units. |
| `netCashFlow` | `distributed - called`, from the investor's perspective. |
| `calledCumulative` | Capital called through this period. |
| `distributedCumulative` | Distributions through this period. |
| `unfunded` | `commitment - calledCumulative`; can be negative when overcalled. |
| `overcalled` | Whether cumulative calls exceed commitment. |
| `nav` | Closing net asset value in minor units. |
| `dpi`, `rvpi`, `tvpi` | Dimensionless investment multiples described below. |

For example, `called: 8000` and `distributed: 2000` mean an $80 outflow, a $20
inflow, and a net cash flow of -$60 when the minor unit is cents. Keep these values
as integers for storage and calculation; convert for display in your application.

Money must stay within JavaScript's safe integer range (`Number.MAX_SAFE_INTEGER`
minor units). Calculations or cumulative amounts beyond that precision are
rejected with `PacingInputError` (`NUMERIC_OVERFLOW`), rather than returning
rounded-away cents, `Infinity`, or `NaN`.

Forecast distributions cannot exceed grown NAV plus this period's calls. Reported
actuals are preserved using the [aggregation rules](user-guide.md#how-transactions-become-historical-periods).
When a historical period has no NAV observation, its NAV is modeled and the
whole row is labeled `'forecast'`. Supplied calls and distributions in that row
are still preserved; the label does not mean every amount was forecast. A
reported NAV of zero counts as actual. Forecast rows may precede actual rows.

## DPI, RVPI, and TVPI

| Multiple | Calculation | Interpretation |
|---|---|---|
| DPI | Cumulative distributions / cumulative calls | Capital returned relative to paid-in capital. |
| RVPI | NAV / cumulative calls | Remaining value relative to paid-in capital. |
| TVPI | DPI + RVPI | Total distributed and remaining value relative to paid-in capital. |

If $100 has been called, $30 distributed, and $90 remains in NAV, DPI is `0.3`,
RVPI is `0.9`, and TVPI is `1.2`. The denominator is paid-in capital, not total
commitment. These are multiples, not annualized returns. All three are zero when
cumulative calls are zero, including when a NAV observation exists without calls.

## Reprojection and variance

| Result field | Meaning |
|---|---|
| `baseline` | Original forecast from the current config and fund terms, without actuals. |
| `revised` | Historical periods incorporating supplied transactions, followed by future forecasts. |
| `variance` | Revised-minus-baseline values over shared periods. |
| `asOf` | End of the latest period containing supplied transactions, regardless of its `source`; `null` with no actuals. |

`asOf` closes the historical horizon. Forecast calls and distributions resume
in the following period, even if modeled NAV makes earlier rows `'forecast'`.
Do not use the first forecast row or the last actual row to infer this cutoff.

Variance rows contain `index`, `periodEnd`, `calledDelta`, `distributedDelta`,
`navDelta`, and `tvpiDelta`. Money deltas are in minor units; `tvpiDelta` is a
difference between multiples. A positive called delta means the revised period
calls more capital than the original forecast. Deltas are per-period comparisons;
there are no cumulative variance fields.

If actuals extend the revised horizon, the baseline retains its original length.
Additional periods have no variance rows; their variance is undefined, not zero.
See [K9](known_issues.md#k9--accepted-variance-covers-only-the-baseline-horizon).

## Readonly results and empty actuals

Output rows are readonly in TypeScript. `project` and `reproject` expose readonly
arrays; `buildSchedule` returns an array of readonly rows. The engine does not
freeze outputs at runtime.

With empty actuals, `baseline` and `revised` currently share an array reference,
`asOf` is `null`, and variance contains zero deltas. Consumers must not mutate
results or rely on distinct references. If you need editable projection data,
copy both the array and its rows with `rows.map(row => ({ ...row }))`.

See the [spec](library_spec.md) for the recurrence and conservation requirements,
and [known issues](known_issues.md) for accepted conventions and future questions.
