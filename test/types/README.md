# Public controller declaration checks

Run `corepack yarn build`, then `corepack yarn test-types` from the repository root.
The same root-export/option fixture is compiled twice with strict TypeScript checks:

- `tsconfig.json` uses the normal repository source aliases.
- `tsconfig.dist.json` removes those aliases and resolves the built workspace packages through
  their root `exports`/`types`, as a consumer does.

This enforces the fixture's `@ts-expect-error` assertions (Vitest only transpiles them), including
Map compatibility aliases, Globe provider variance and custom-controller options. No deep-import
mapping or temporary developer-local configuration is needed. Required CI builds packages before
`test-ci`, which runs this check as well as runtime tests.
