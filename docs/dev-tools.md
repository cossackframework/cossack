# DevTools

Cossack includes built-in developer tools to enhance your productivity during development. The primary feature is **Click-to-Source**, which allows you to jump directly from a component in your browser to its corresponding source code in your editor.

## Click-to-Source

When running in development mode, you can inspect any Cossack component on the page and open it in your code editor (e.g., VS Code).

### How to Use

1.  **Enter Inspection Mode**: Hold the `Alt` (or `Option` on Mac) key while your browser window is focused.
2.  **Hover**: Move your mouse over the page. A blue overlay will highlight the component currently under your cursor and display its filename.
3.  **Click**: While holding `Alt`, click on the highlighted component. Cossack will automatically open that file in your configured code editor and scroll to the class definition.

## Setup & Requirements

### Development Mode
DevTools are only enabled when the framework is running with `COSSACK_DEV=true`. This is handled automatically by the default `pnpm run dev` script.

### DevTools Server
Cossack runs a tiny background server on port `3333` during development. This server acts as a bridge between your browser and your local file system, which is particularly useful for environments like **WSL** or remote containers where standard protocol handlers (like `vscode://`) might fail.

### Editor Configuration
Cossack defaults to opening files in **VS Code**. Ensure that the `code` command is available in your system's `PATH`.

## How it Works

1.  **Vite Transformation**: A custom Vite plugin scans your `.ts` files and injects the absolute file path as a static property into every class that extends `Cossack`.
2.  **DOM Markers**: At runtime, the `Cossack` base class wraps the component's rendered output with HTML comment markers (e.g., `<!--cossack-start:{...}-->`).
3.  **Client Inspector**: The client-side DevTools script listens for the `Alt` key and uses `document.elementFromPoint` to find the markers corresponding to the hovered element.
4.  **Bridge**: Clicking the component sends a request to the local DevTools server, which executes the system command to open your editor.

## Troubleshooting

-   **Overlay doesn't appear**: Ensure your browser console shows `[Cossack] DevTools enabled`. If not, check that you are running in dev mode.
-   **Click doesn't open editor**: Check your terminal for logs from the `[DevTools]` server. Ensure the `code` command works manually in your terminal.
-   **Port Conflict**: If port `3333` is occupied, the DevTools server will fail to start. You can currently change this port in `packages/framework/scripts/dev-tools.js`.
