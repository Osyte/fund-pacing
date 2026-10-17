# Installation

[README](../README.md) · [Configuration](configuration.md) · [User guide](user-guide.md)

## Requirements

Use Node.js 20 or later, or a modern browser application with a module bundler.
The package includes ESM, CommonJS, and TypeScript declarations. The core has no
runtime dependencies and does not require a server or a database.

## Install the package

Choose the command for your package manager:

```sh
npm install @osyte/fund-pacing
```

```sh
pnpm add @osyte/fund-pacing
```

```sh
yarn add @osyte/fund-pacing
```

Install it as an application dependency. You do not need to clone this repository
or build the library to consume a published package.

## JavaScript with ES modules

In Node, use an `.mjs` file or set `"type": "module"` in your application's
`package.json`. In a browser application, import through your bundler:

```js
import { buildSchedule, project, reproject, validateConfig } from '@osyte/fund-pacing'

console.log(typeof project) // 'function'
```

These functions calculate data in the current process. The library does not start
an HTTP service or create a global browser variable. The package does not ship a
standalone script-tag build.

## JavaScript with CommonJS

In a `.cjs` file, or a Node project using CommonJS:

```js
const { buildSchedule, project, reproject, validateConfig } = require('@osyte/fund-pacing')

console.log(typeof project) // 'function'
```

## TypeScript

Types are bundled; no separate `@types` package is needed.

```ts
import { project, type ModelConfig, type Transaction } from '@osyte/fund-pacing'
```

Use a module-resolution mode suited to your application, such as `NodeNext` for
a Node ESM application or `Bundler` for a bundled frontend. Configure your
application's build separately from the library's development configuration.

See the [quick example](../README.md#quick-example) for a complete typed config
and the [user guide](user-guide.md) for each function.

## Optional Zod schemas

Only consumers importing `@osyte/fund-pacing/schema` need Zod. Install the
supported optional peer version explicitly:

```sh
npm install zod@^4
```

```ts
import {
  ModelConfigSchema,
  FundTermsSchema,
  TransactionSchema,
  TransactionsSchema,
} from '@osyte/fund-pacing/schema'
```

Core imports do not load Zod. Schema parsing does not replace engine validation;
see [validation and errors](validation.md#optional-zod-schemas).

## Common installation and import problems

| Symptom | What to check |
|---|---|
| `Cannot find package '@osyte/fund-pacing'` | Install it in the application or workspace package that imports it, and confirm the package name and registry access. |
| `Cannot use import statement outside a module` | Use `.mjs`, an ESM package, or your bundler; alternatively use the CommonJS example. |
| `require is not defined` | Use `import` in an ESM file, or move the CommonJS example to a `.cjs` file. |
| Missing `zod` after importing `/schema` | Install Zod 4 in the consuming application. |
| TypeScript cannot resolve declarations | Check your module-resolution mode and that the installed package contains its built `dist` files. |
| A copied config is rejected | Check the installed package version and [configuration migration](configuration.md#migrating-from-termperiods); pre-1.0 interfaces may change. |

For development from a checkout, follow [Contributing](../CONTRIBUTING.md#setup).
Those build and test steps are separate from installing the published library.
