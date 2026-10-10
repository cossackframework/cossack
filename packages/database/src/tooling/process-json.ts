import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ORMCommandOptions } from "./index.js";

// Only repository-owned code is evaluated. Command arguments and options travel
// over IPC, so paths and values never become executable source or shell text.
const BOOTSTRAP = `
process.once("message", async ({ moduleURL, loaderURL, argv, options }) => {
  try {
    const { register } = await import(loaderURL);
    const unregister = register();
    const { runORMCommandInProcess } = await import(moduleURL);
    let result;
    const exitCode = await runORMCommandInProcess(argv, {
      ...options,
      stdout: message => { result = JSON.parse(message); },
      stderr: () => {},
    });
    await unregister();
    process.send({ type: "orm-result", exitCode, result }, () => process.exit(exitCode));
  } catch {
    // Bootstrap failures may contain configuration values. The parent emits
    // a stable diagnostic instead of forwarding this process's raw output.
    process.exit(1);
  }
});
`;

interface ProcessResult {
  readonly type: "orm-result";
  readonly exitCode: number;
  readonly result: Record<string, unknown>;
}

function isResult(message: unknown): message is ProcessResult {
  if (!message || typeof message !== "object") return false;
  const value = message as Partial<ProcessResult>;
  const result = value.result;
  return value.type === "orm-result" && (value.exitCode === 0 || value.exitCode === 1) &&
    !!result && result["schemaVersion"] === 1 && typeof result["command"] === "string" &&
    typeof result["ok"] === "boolean" && Array.isArray(result["diagnostics"]) &&
    result["ok"] === (value.exitCode === 0);
}

/** Execute configuration, adapters and callbacks with isolated stdout/stderr. */
export async function runJSONORMCommand(
  moduleURL: string, argv: readonly string[], options: ORMCommandOptions,
): Promise<number> {
  const out = options.stdout ?? console.log;
  let response: ProcessResult | undefined;
  let exitCode: number | null = null;
  try {
    const require = createRequire(import.meta.url);
    const loaderURL = pathToFileURL(require.resolve("tsx/esm/api")).href;
    exitCode = await new Promise<number | null>((resolve) => {
      // Keep eval in its default CommonJS mode. Miniflare's synchronous binding
      // bridge starts a CommonJS eval Worker which inherits these Node flags.
      // --input-type=module makes that Worker fail before it can notify the
      // blocked parent thread, so local D1 commands never return.
      const child = spawn(process.execPath, ["--eval", BOOTSTRAP], {
        cwd: options.cwd ?? process.cwd(),
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        shell: false,
      });
      child.on("message", message => { if (isResult(message)) response = message; });
      child.once("error", () => resolve(null));
      child.once("close", code => resolve(code));
      const { stdout: _stdout, stderr: _stderr, ...serializableOptions } = options;
      child.send({ moduleURL, loaderURL, argv, options: serializableOptions }, error => {
        if (error) child.kill();
      });
    });
  } catch {
    // No configuration excerpts, connection logs, or child stack traces escape.
  }
  if (response && exitCode === response.exitCode) {
    out(JSON.stringify(response.result));
    return response.exitCode;
  }
  out(JSON.stringify({ schemaVersion: 1, command: argv[0]?.startsWith("-") ? "orm" : argv[0] ?? "orm",
    action: argv[1]?.startsWith("-") ? null : argv[1] ?? null, ok: false, data: null,
    diagnostics: [{ code: "COSSACK_ORM_PROCESS_FAILED", severity: "error",
      message: "Database tooling exited before returning a result. Run without --json for tool diagnostics." }] }));
  return 1;
}
