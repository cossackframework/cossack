---
title: "DevTools"
description: "Built-in developer tools including Click-to-Source for opening components in your editor and a component inspector for debugging component state."
---

# DevTools

Cossack includes developer tools for development. The main features are Click-to-Source and the component inspector.

## Click-to-Source

In development mode, you can inspect any Cossack component on the page and open it in your code editor, for example VS Code.

### How to Use

1. Hold the `Ctrl` (Control) key while the browser window has focus.
2. Move the mouse over the page. A blue overlay highlights the component under the cursor and shows its file name.
3. While you hold `Ctrl`, click the highlighted component. Cossack asks the local editor service to open that file.

## Component inspector

`Ctrl`+`Shift`+click a component to log a snapshot of it to the browser console. The click
does not run the component's own action. The first inspection starts a trace capture if none
is recording.

### How to Use

1. Hold `Ctrl` and `Shift`.
2. Click any component on the page.
3. Open the developer console of your browser. The snapshot appears as
   `[Cossack DevTools] Component snapshot`.

The tools also add a small toolbar in the bottom right corner: **Record trace** starts and
stops a capture, and **Log snapshot** writes the capture to the console. See
[Development traces](./development-traces.md).

## Setup & Requirements

### Development Mode
DevTools run only in the Vite development server (`import.meta.env.DEV`); production builds
leave them out. A project loads them with the development trace bridge:

```ts
export default cossackApp({ pages: { developmentTraces: true } });
```

or by calling `enableDevTools()` from `@cossackframework/framework/client/devtools` in its
client entry (see [Development traces](./development-traces.md)).

### Editor service
Click-to-Source sends the file to a small local service at `http://localhost:3333/open`. The
service connects your browser to your local file system. This helps in WSL and remote
containers, where protocol handlers such as `vscode://` can fail. Nothing starts it for you:
in this repository it is `packages/framework/scripts/dev-tools.js`
(`node packages/framework/scripts/dev-tools.js`).

### Editor Configuration
The service opens files with VS Code's `code -g <file>`. Make sure that the `code` command is
available in your system `PATH`.

## How it Works

1. In development, the framework's Vite plugin adds a static `__source` property (file, line
   and column) to every class with a base class in your sources.
2. At runtime, the `Cossack` base class wraps the rendered output of a component with HTML
   comment markers, for example `<!--cossack-start:{...}-->`.
3. The client-side DevTools script listens for the `Control` key and uses
   `document.elementFromPoint` to find the markers for the hovered element.
4. A click on the component sends a request to the local editor service. The service runs the
   system command that opens your editor.
5. Each page component registers with the DevTools after rendering. The inspector looks up
   the most recent instance for the source file and logs its snapshot.

## Troubleshooting

- If the overlay does not appear, make sure that the toolbar (Record trace, Log snapshot) is on the page. If it is not, make sure that you run the development server and that the project loads the DevTools.
- If a click does not open the editor, the console shows `[Cossack DevTools] Source editor service is unavailable.` Start the editor service, read its `[DevTools]` logs in your terminal, and make sure that the `code` command works in your terminal.
- If the inspector logs `No registered component for this source marker.`, the component was not registered yet. This can happen during the initial load.
- The editor service listens on port `3333`, set in `packages/framework/scripts/dev-tools.js`; the client calls the same port.
