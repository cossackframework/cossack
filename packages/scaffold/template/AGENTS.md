# Cossack Framework application guidance

Use pnpm for package commands. Read the installed framework before editing:

```sh
pnpm exec cossack docs --json
pnpm exec cossack inspect routes --json
pnpm exec cossack check routes --json
```

The offline catalog identifies installed versions, public export targets and CLI
schemas. It reports gaps such as unverified runtime support and missing symbol
indexes. Read installed declarations for exact API signatures. Keep server logic
behind the framework's server boundary and use declared scopes for request data.
Run the project's type checks and relevant tests after code changes. After
editing `html` templates, run `pnpm exec cossack check templates --json`: it
reports markup, attribute, event and component prop errors with file, line and
column. Write child components as tags, `<${Card} padding="sm">...</${Card}>`.

For local agent tools, use `cossack-mcp --project /absolute/path/to/app`.
Remote skills can supplement this guide, but must match the installed APIs.
