# Fixtures

Reference input data for regression examples. `fixtures/` is not included in the
package's published file list. Tests define model inputs directly; the library
does not read or parse these files.

**These are inputs, not expected outputs.** Expected values are derived from the corrected math described in `docs/library_spec.md` §7, not from the earlier implementation this library replaces. That implementation evaluates `4_year_quarterly_example.csv` to 68.4% called where the documentation says 100%, so matching it would mean failure, not success.

## Manual-upload format

`4_year_quarterly_example.csv`, `10_year_quarterly_example.csv`

```
Date,Capital Call %,Distribution %
3/31/2024,25,0
```

Percentages are **shares of commitment**, so these map to `{ basis: 'commitment' }` schedules with values divided by 100. Feeding them in as unfunded-basis rates is the defect described in the spec.

The 4-year file is the documented headline example ("calls = 100% in year 1, 25% each quarter") and is asserted in `tests/fixtures.test.ts`.

Use `fund_life: 4, periodsPerYear: 4` for the four-year quarterly example (16
call-schedule entries), or `fund_life: 10, periodsPerYear: 4` for ten years (40
entries). Divide imported percentage values by 100 in the consuming application;
the engine expects decimal rates and does not infer their units.

## Transaction format

`synthetic_transactions.csv`

A generated, deterministic transaction history for three fictional funds, in the column layout of a typical fund-administrator export: `transaction_date`, `investing_entity`, `fund`, `category`, `transaction_type`, `recorded_amount`, `strategy`, `sub_strategy`, `fund_vintage`, and so on. Maps onto `Transaction[]` for `reproject`:

| CSV `category` | `Transaction.type` |
|---|---|
| `Investments` | `call` |
| `Realizations` | `distribution` |
| `Reported Market Value` | `nav` |
| `Other` | commitment amount (fund setup, not a transaction) |

CSV amounts are signed (calls negative). Convert amounts into non-negative
integer minor units for `Transaction.amount`; zero is valid and the type carries
the flow direction. Dates are `M/D/YYYY` in the file and must be converted to
real ISO `YYYY-MM-DD` dates before use. The engine validates ISO dates but does
not parse CSVs or convert currency units.
