# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may include breaking changes.

## Unreleased

- Removed `callablePeriods`; `callSchedule.rates` now has one entry per `termPeriods` period, with explicit `0` rates for no-call periods.
- Forecast calls can begin in period 0, and `termPeriods` now maps directly to output rows `0..termPeriods - 1`.
- Commitment-basis `reproject` forecasts now rescale remaining calls after actuals so total called capital returns to commitment.
- Commitment-basis call schedules now must sum to 1.
- Added validation errors for call schedules whose length does not match `termPeriods`.
- Hardened `validateConfig` so malformed runtime config shapes return validation issues instead of throwing `TypeError`.

## 0.1.0

Initial release.

- `buildSchedule`: dimensionless Takahashi–Alexander pacing curve from model parameters
- `project`: dated cash flows in minor units from a commitment and start date
- `reproject`: revised forecast from observed calls, distributions, and NAVs, with baseline and variance
- `validateConfig` and optional zod schemas under `@osyte/fund-pacing/schema`
- Explicit schedule bases (`commitment`, `unfunded`, `nav`), geometric rate conversion, exact conservation including when overcalled
