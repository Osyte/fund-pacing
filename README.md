# @osyte/fund-pacing

[![CI](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml/badge.svg)](https://github.com/osyte/fund-pacing/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@osyte/fund-pacing)](https://www.npmjs.com/package/@osyte/fund-pacing)
[![license: MIT](https://img.shields.io/npm/l/@osyte/fund-pacing)](LICENSE)

A JavaScript/TypeScript library for modeling private fund cash flows using the
Takahashi–Alexander model. Stateless, deterministic, and dependency-free at its core.

## Installation

```sh
npm install @osyte/fund-pacing
```

Supports Node 20+ and modern browser bundlers, with ESM, CommonJS, and TypeScript
declarations. See the [installation guide](docs/installation.md) for package
managers, imports, optional schemas, and troubleshooting.

## Understand your configuration

Configuration defines the assumptions behind the model: fund life, periodicity,
growth, and how capital is called and distributed. Investment size, start date,
and transaction history are separate inputs.

**Understanding the configuration is essential to interpreting the results.**
Periodicity affects the number of periods, schedule entries, dates, and how the
curve behaves. The engine requires explicit assumptions; it does not choose
investment defaults for you.

Read the [configuration guide](docs/configuration.md) for how to enter each
parameter, its units, constraints, and interactions.

## What can you do with it?

The library exposes four functions:

| Function | Purpose |
|---|---|
| `buildSchedule(config)` | Create curves and explore how different assumptions affect them, independently of investment size and dates. |
| `project(config, fund)` | Forecast cash flows for a prospective or new investment. |
| `reproject(config, fund, actuals)` | Use an investment's history to produce a revised forecast alongside the original forecast. |
| `validateConfig(config)` | Reuse the model's validation rules in your application, rather than duplicating validation logic. |

See the [user guide](docs/user-guide.md) for when to use each function, complete
examples, inputs, and outputs. Each function can be called directly.

## Quick example

```ts
import { project, type ModelConfig } from '@osyte/fund-pacing'

const config = {
  fund_life: 4, // years
  periodsPerYear: 4, // quarterly: 16 periods
  growthRate: 0.15, // annual decimal rate
  yieldRate: 0,
  bowFactor: 2.5,
  callSchedule: {
    basis: 'commitment',
    rates: [0.25, 0.25, 0.25, 0.25, ...Array(12).fill(0)],
  },
  terminalLiquidation: true,
  termExtensionYears: 3,
} satisfies ModelConfig

const rows = project(config, {
  commitment: 1_000_000_000, // $10 million in cents
  startDate: '2024-01-15',
})

console.log(rows[0]?.called) // 250000000 cents ($2.5 million)
console.log(rows[0]?.periodEnd) // '2024-03-31'
```

## Understand the results

Projections return calls, distributions, net cash flow, NAV, unfunded commitment,
and investment multiples for each period. Money is in integer minor units;
dates are ISO strings. See [understanding results](docs/results.md).

For [validation and errors](docs/validation.md), the
[accepted v0.x conventions and known limitations](docs/known_issues.md), or
model rationale, see the [spec](docs/library_spec.md). The library is pre-1.0;
the public interface may change before a stable release.

## Contributing and feedback

Found a bug or something you'd like to change? Excellent!

Worked out a fix? Even better!

Want to share a question, suggestion, or experience using the library? We'd love to hear it.

Start with the [contributing guide](CONTRIBUTING.md). You do not need a fix to
report a problem or suggest an improvement. Security reports follow the
[security policy](SECURITY.md).
