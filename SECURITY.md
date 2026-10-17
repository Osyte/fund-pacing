# Security

This library is pure computation with no I/O, no network access, and no runtime dependencies, so its attack surface is small. The main risks are denial of service through pathological input (for example, extremely large `fund_life * periodsPerYear`) and incorrect financial output.

If you find a problem you believe has security impact, please do not open a public issue. Email the maintainers at the address on the npm package page or the GitHub organisation profile, and include a reproduction. You should hear back within a week.

Incorrect model output that is not a security concern belongs in a regular GitHub issue.
