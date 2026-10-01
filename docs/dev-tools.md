---
title: "DevTools"
description: "Built-in developer tools including Click-to-Source for opening components in your editor and State Inspector for debugging component state."
---

# DevTools

Cossack includes built-in developer tools to enhance your productivity during development. The primary features are **Click-to-Source** and **State Inspector**.

## Click-to-Source

When running in development mode, you can inspect any Cossack component on the page and open it in your code editor (e.g., VS Code).

### How to Use

1. **Enter Inspection Mode**: Hold the `Ctrl` (or `Command` on Mac) key while your browser window is focused.
2. **Hover**: Move your mouse over the page. A blue overlay will highlight the component currently under your cursor and display its filename.
3. **Click**: While holding `Command`, click on the highlighted component. Cossack will automatically open that file in your configured code editor and scroll to the class definition.

## State Inspector

Double-click on any component while holding `Ctrl` to inspect its current state in the browser console. This logs the component instance, its public state, current path, and mount status.

### How to Use

1. Hold `Ctrl` (or `Command` on Mac).
2. **Double-click** on any component on the page.
3. Open your browser's developer console to see the component's state logged in a grouped, formatted output.

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
DevTools are only enabled when the framework is running with `COSSACK_DEV=true`. This is handled automatically by the default `pnpm run dev` script.

### DevTools Server
Cossack runs a small background server on port `3333` during development. The server connects your browser to your local file system. This helps in **WSL** and remote containers, where protocol handlers such as `vscode://` can fail.

### Editor Configuration
Cossack defaults to opening files in **VS Code**. Make sure that the `code` command is available in your system's `PATH`.

## How it Works

1. **Vite Transformation**: A custom Vite plugin scans your `.ts` files and injects the absolute file path as a static property into every class that extends `Cossack`.
2. **DOM Markers**: At runtime, the `Cossack` base class wraps the component's rendered output with HTML comment markers (e.g., `<!--cossack-start:{...}-->`).
3. **Client Inspector**: The client-side DevTools script listens for the `Ctrl` key and uses `document.elementFromPoint` to find the markers corresponding to the hovered element.
4. **Bridge**: Clicking the component sends a request to the local DevTools server, which executes the system command to open your editor.
5. **State Registry**: Each page component is registered with the DevTools after bootstrap. The double-click inspector looks up the component instance and logs its state.

## Troubleshooting

- **Overlay does not appear**: Make sure that your browser console shows `[Cossack] DevTools enabled`. If it does not, make sure that you are running in dev mode.
- **Click does not open editor**: Read the `[DevTools]` server logs in your terminal. Make sure that the `code` command works in your terminal.
- **State Inspector shows a warning**: If you see `No registered instance for: ...`, the component was not registered yet. This can happen during the initial load.
- **Port Conflict**: If port `3333` is occupied, the DevTools server will fail to start. You can currently change this port in `packages/framework/scripts/dev-tools.js`.
