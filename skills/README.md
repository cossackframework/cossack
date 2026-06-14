# Cossack Skills

Agent Skills for working with the [Cossack Framework](https://github.com/cossackframework/cossack) — a full-stack TypeScript framework where a single component class runs on both server and client.

These skills teach AI coding assistants (Claude Code, Open Code, and any Agent Skills-compatible tool) the framework's conventions and built-in features, so the assistant reaches for `@Validate`, `Image()`, `this.loading`, `@Ref()`, etc. instead of reinventing them.

## Skills

### Background (auto-applied)

These load automatically when you work on Cossack files. You don't invoke them.

| Skill | What it does |
|---|---|
| [`cossack-best-practices`](./cossack-best-practices/SKILL.md) | Directive guardrails: use framework built-ins instead of rolling your own. Ships deep-dive references for decorators, validation, loading, realtime (SSE + Durable Object), auth, and error handling. |

### Slash commands

Invoke explicitly for multi-step workflows.

| Command | What it generates |
|---|---|
| [`/setup-auth`](./setup-auth/SKILL.md) | Full auth setup: install `@cossackframework/auth`, types, `createAuth()` config, middleware wiring, login route, protected pages. |
| [`/setup-websocket`](./setup-websocket/SKILL.md) | Real-time setup: pick SSE or Durable Object transport, wire channels/scope, configure the DO binding. |

For everything else (creating pages, layouts, components, adding state or middleware), just ask in plain language — the background skill gives the assistant everything it needs.

## Installation

### Option 1 — Skills.sh

```bash
npx skills add https://github.com/cossackframework/skills
```

### Option 2 — Copy or symlink into a project

```bash
# Per-project (loads as `cossack@skills-dir`)
cp -r /path/to/cossack/skills .claude/skills/cossack

# Or symlink for development (stays in sync with the monorepo)
ln -s /path/to/cossack/skills .claude/skills/cossack
```

### Option 3 — Per-session

```bash
claude --plugin-dir /path/to/cossack/skills
```

After installing, restart your tool (or run `/reload-plugins` in Claude Code). The background skill activates on the next edit to `src/pages/**`, `src/components/**`, `src/services/**`, `src/middlewares/**`, `src/App.ts`, or `src/root.ts`.

## Usage

```
> add an email field with validation to the login form
# background skill kicks in → assistant uses @Validate(), not a custom validator

> /setup-auth
# interactive workflow scaffolds auth across types, auth.ts, index.ts, pages, guards

> set up a live counter that syncs across tabs
# /setup-websocket walks through SSE vs DO and wires the transport
```

## Compatibility

- [Claude Code](https://claude.com/claude-code) — Anthropic's CLI
- [Open Code](https://github.com/opencode-ai/opencode)
- Any tool that supports the Agent Skills convention (`.claude-plugin/plugin.json` + `SKILL.md`)

## Repository

This directory is auto-synced from [`cossackframework/cossack`](https://github.com/cossackframework/cossack) on every change to `skills/`. For the full framework documentation, see [cossack.dev](https://cossack.dev) and the [`docs/` directory](https://github.com/cossackframework/cossack/tree/master/docs) in the monorepo.
