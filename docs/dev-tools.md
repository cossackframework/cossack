---
title: "DevTools"
description: "Built-in developer tools including Click-to-Source for opening components in your editor and State Inspector for debugging component state."
---

# DevTools

Cossack includes built-in developer tools for development. The main features are Click-to-Source and State Inspector.

## Click-to-Source

In development mode, you can inspect any Cossack component on the page and open it in your code editor, for example VS Code.

### How to Use

1. Hold the `Ctrl` key, or `Command` on a Mac, while the browser window has focus.
2. Move the mouse over the page. A blue overlay highlights the component under the cursor and shows its filename.
3. While you hold `Command`, click the highlighted component. Cossack opens that file in your configured code editor and scrolls to the class definition.

## State Inspector

Double-click any component while you hold `Ctrl` to inspect its current state in the browser console. This logs the component instance, its public state, the current path, and the mount status.

### How to Use

1. Hold `Ctrl`, or `Command` on a Mac.
2. Double-click any component on the page.
3. Open the developer console of your browser. The component state appears as grouped, formatted output.

### Example Console Output

```
▼ [Cossack DevTools] State: /src/pages/dashboard/index.ts
    Instance: Dashboard {count: 5, ...}
    Public State: {count: 5, items: [...]}
    Path: /dashboard
    Mounted: true
```

## Setup & Requirements

### Development Mode
DevTools are only enabled when the framework runs with `COSSACK_DEV=true`. The default `pnpm run dev` script sets this automatically.

### DevTools Server
Cossack runs a small background server on port `3333` during development. The server connects your browser to your local file system. This helps in WSL and remote containers, where protocol handlers such as `vscode://` can fail.

### Editor Configuration
Cossack opens files in VS Code by default. Make sure that the `code` command is available in your system `PATH`.

## How it Works

1. A custom Vite plugin scans your `.ts` files and injects the absolute file path as a static property into every class that extends `Cossack`.
2. At runtime, the `Cossack` base class wraps the rendered output of a component with HTML comment markers, for example `<!--cossack-start:{...}-->`.
3. The client-side DevTools script listens for the `Ctrl` key and uses `document.elementFromPoint` to find the markers for the hovered element.
4. A click on the component sends a request to the local DevTools server. The server runs the system command that opens your editor.
5. Each page component registers with the DevTools after bootstrap. The double-click inspector looks up the component instance and logs its state.

## Troubleshooting

- If the overlay does not appear, make sure that the browser console shows `[Cossack] DevTools enabled`. If it does not, make sure that you run in dev mode.
- If a click does not open the editor, read the `[DevTools]` server logs in your terminal. Make sure that the `code` command works in your terminal.
- If the State Inspector shows a warning with `No registered instance for: ...`, the component was not registered yet. This can happen during the initial load.
- If port `3333` is occupied, the DevTools server fails to start. You can change this port in `packages/framework/scripts/dev-tools.js`.
