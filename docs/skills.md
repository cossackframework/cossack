# Cossack Skills for Claude Code & Open Code

Cossack Skills are instruction packs that teach AI coding assistants (Claude Code, Open Code, and any Agent Skills-compatible tool) how to work with the Cossack Framework. They provide step-by-step guidance for common tasks like creating pages, adding state, setting up auth, and more.

## What's Included

| Skill | Type | Description |
|-------|------|-------------|
| `/create-page` | Task | Generate a new Cossack page with correct routing, transport, and patterns |
| `/create-layout` | Task | Create a layout component that wraps page content |
| `/create-component` | Task | Create a reusable component with props, events, and server actions |
| `/add-state` | Task | Add state management (`@State`, `@ClientState`, `@Computed`, `@Validate`, `@Optimistic`) |
| `/add-middleware` | Task | Add server middleware to pages and layouts |
| `/setup-auth` | Task | Set up authentication with `@cossackframework/auth` |
| `/setup-websocket` | Task | Set up real-time WebSocket features with Durable Objects |
| `cossack-reference` | Reference | Auto-loaded background knowledge (decorators, syntax, routing, conventions) |

The `cossack-reference` skill is not user-invocable. It auto-loads when you work on Cossack-specific files (`src/pages/**`, `src/components/**`, `src/services/**`, `src/middlewares/**`, `src/App.ts`, `src/root.ts`).

## Installation

### Option 1: Marketplace Install (Recommended)

Install from the dedicated plugin repository. This is the easiest way for most users:

```bash
claude plugin install cossack-skills
```

The plugin repo ([cossackframework/skills](https://github.com/cossackframework/skills)) is auto-synced from the monorepo on every change to `skills/`.

### Option 2: Skills-Directory Plugin

Copy or symlink the `skills/` folder into `.claude/skills/` in your project. Claude Code auto-discovers any folder containing a `.claude-plugin/plugin.json` manifest and loads it as a plugin named `<name>@skills-dir` — no marketplace or install step needed.

**In a Cossack app project:**

```bash
# Clone or copy the skills directory into your project
cp -r /path/to/cossack/skills .claude/skills/cossack

# Or symlink for development (stays in sync with the monorepo)
ln -s /path/to/cossack/skills .claude/skills/cossack
```

After this, the plugin loads as `cossack@skills-dir` on the next Claude Code session. All skills (`/create-page`, `/add-state`, etc.) are immediately available.

**Global (all projects):**

```bash
cp -r /path/to/cossack/skills ~/.claude/skills/cossack
```

Global skills load in every project.

### Option 3: Per-Session with `--plugin-dir`

Use `--plugin-dir` to load the skills for a single session without any setup:

```bash
# From inside a Cossack project
claude --plugin-dir /path/to/cossack/skills

# Or from the monorepo itself
claude --plugin-dir ./skills
```

### Option 4: Manual (Individual Skills)

Copy individual skill folders to `.claude/skills/` in your project or globally:

```bash
# Per-project — copy only the skills you need
cp -r skills/cossack-reference .claude/skills/
cp -r skills/create-page .claude/skills/

# Global
cp -r skills/cossack-reference ~/.claude/skills/
cp -r skills/create-page ~/.claude/skills/
```

Individual skill folders (without a `.claude-plugin/plugin.json`) register as plain skills, not as a plugin. They still work but don't get the namespaced `cossack@skills-dir` identity.

## Usage

### Invoking Skills

Use the slash command syntax in your AI tool:

```
/create-page
/create-layout
/create-component
/add-state
/add-middleware
/setup-auth
/setup-websocket
```

The skill will guide the AI through the correct patterns, asking questions as needed.

### Auto-Loading Reference

The `cossack-reference` skill activates automatically when you open or edit Cossack files. You don't need to invoke it. It provides the AI with background knowledge about decorators, template syntax, routing conventions, and build commands.

Example: Open `src/pages/about/index.ts` and ask "How do I add a @State property?" — the AI will use the reference skill knowledge to give an accurate answer.

## Compatible Tools

- [Claude Code](https://claude.com/claude-code) — Anthropic's CLI tool
- [Open Code](https://github.com/opencode-ai/opencode) — Open-source AI coding agent
- Any tool that supports Agent Skills (`.claude-plugin/plugin.json` + `SKILL.md` convention)

## Troubleshooting

### Skills Not Showing

1. Verify the skill directory contains a `SKILL.md` file
2. Check that the skill folder is in the right location (`.claude/skills/` or registered as a plugin)
3. Restart your AI tool after installing new skills

### Plugin Not Loading

1. Verify `.claude/skills/cossack/.claude-plugin/plugin.json` exists
2. Run `claude plugin list` — the plugin should appear as `cossack@skills-dir`
3. If it doesn't appear, run `/reload-plugins` inside Claude Code or restart the session
4. Check that you launched Claude Code from the project root (project-scope plugins only scan `<cwd>/.claude/skills/`)

### Skills Out of Date

If you symlinked the skills directory, pulling the latest changes is enough — skills auto-refresh. If you copied, re-copy from the monorepo:

```bash
rm -rf .claude/skills/cossack
cp -r /path/to/cossack/skills .claude/skills/cossack
```
