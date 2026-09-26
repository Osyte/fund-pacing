# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may include breaking changes.

## Unreleased

## 0.1.0

Initial release.

- `buildSchedule`: dimensionless Takahashi–Alexander pacing curve from model parameters
- `project`: dated cash flows in minor units from a commitment and start date
- `reproject`: revised forecast from observed calls, distributions, and NAVs, with baseline and variance
- `validateConfig` and optional zod schemas under `@osyte/fund-pacing/schema`
- Explicit schedule bases (`commitment`, `unfunded`, `nav`), geometric rate conversion, exact conservation including when overcalled
