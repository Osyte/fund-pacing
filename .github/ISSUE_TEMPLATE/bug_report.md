---
name: Bug report
about: Wrong output, an unexpected error, or a broken invariant
labels: bug
---

**What happened**

**What you expected**

**Minimal reproduction**

```ts
import { project } from '@osyte/fund-pacing'

const config = { /* ... */ }
const fund = { commitment: 0, startDate: '' }
console.log(project(config, fund))
```

**Environment**

- `@osyte/fund-pacing` version:
- Node / browser:
