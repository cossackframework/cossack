import { mkdir, rm, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ORMToolingContext } from "../config.js";
import type { Adapter } from "../adapter/types.js";
import { ConfigurationError } from "../errors.js";
import { d1, type D1DatabaseBinding } from "../runtime/cloudflare.js";

interface D1Config {
  binding: string;
  database_name?: string;
  database_id?: string;
  preview_database_id?: string;
}
interface WranglerConfig {
  account_id?: string;
  name?: string;
  main?: string;
  compatibility_date?: string;
  compatibility_flags?: string[];
  d1_databases: D1Config[];
}
type RawWranglerSection = Record<string, unknown>;
type RawWranglerConfig = RawWranglerSection & { env?: Record<string, RawWranglerSection> };

/** Structural API keeps Wrangler owned by the application, outside the library dependency graph. */
export interface ToolingWrangler {
  experimental_readRawConfig(args: { config: string }): { rawConfig: RawWranglerConfig };
  unstable_readConfig(args: { config: string; env?: string }, options: { hideWarnings: boolean }): WranglerConfig;
  getPlatformProxy(options: {
    configPath: string; environment?: string; remoteBindings: boolean;
    persist: false | { path: string };
  }): Promise<{ env: Record<string, unknown>; dispose(): Promise<void> }>;
}

export interface D1ToolingOptions {
  readonly binding?: string;
  readonly configPath?: string;
  /** Test/integration injection; production resolves Wrangler from context.cwd. */
  readonly wrangler?: ToolingWrangler;
}

async function readCloudflareConfig(
  context: Pick<ORMToolingContext, "cwd" | "environment">,
  options: Pick<D1ToolingOptions, "configPath" | "wrangler">,
) {
  let configPath = options.configPath ? resolve(context.cwd, options.configPath) : undefined;
  if (!configPath) {
    for (const name of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
      const candidate = join(context.cwd, name);
      try { await access(candidate); configPath = candidate; break; } catch {}
    }
  }
  if (!configPath) throw new ConfigurationError("No Wrangler configuration exists in the tooling project root.");
  let wrangler = options.wrangler;
  if (!wrangler) {
    const require = createRequire(join(context.cwd, "package.json"));
    wrangler = await import(pathToFileURL(require.resolve("wrangler")).href) as ToolingWrangler;
  }
  if (typeof wrangler.experimental_readRawConfig !== "function" || typeof wrangler.unstable_readConfig !== "function") {
    throw new ConfigurationError("The project's Wrangler does not support Cossack configuration discovery. Update Wrangler.");
  }
  let config: WranglerConfig;
  let raw: RawWranglerConfig;
  try {
    raw = wrangler.experimental_readRawConfig({ config: configPath }).rawConfig;
    if (context.environment && !Object.hasOwn(raw.env ?? {}, context.environment)) {
      throw new ConfigurationError(`Cloudflare environment "${context.environment}" is not configured.`);
    }
    config = wrangler.unstable_readConfig({ config: configPath,
      ...(context.environment ? { env: context.environment } : {}) }, { hideWarnings: true });
  } catch (cause) {
    if (cause instanceof ConfigurationError) throw cause;
    // Wrangler errors can embed config excerpts containing credential values.
    throw new ConfigurationError("Wrangler could not validate the configuration. Check its syntax and binding declarations.");
  }
  return { config, configPath, raw, wrangler };
}

type ResolvedCloudflareConfig = Awaited<ReturnType<typeof readCloudflareConfig>>;

/**
 * Tooling never runs the Worker entry, so Durable Objects and Workflows that
 * the Worker itself implements cannot exist in the proxy. Wrangler warns about
 * each of them; drop them because tooling never uses them.
 */
function withoutWorkerOwnedClasses(section: RawWranglerSection): { section: RawWranglerSection; changed: boolean } {
  const next = { ...section };
  let changed = false;
  const durableObjects = next.durable_objects as { bindings?: { script_name?: string }[] } | undefined;
  if (durableObjects?.bindings?.some(binding => !binding.script_name)) {
    const bindings = durableObjects.bindings.filter(binding => binding.script_name);
    if (bindings.length) next.durable_objects = { ...durableObjects, bindings };
    else delete next.durable_objects;
    changed = true;
  }
  const workflows = next.workflows as { script_name?: string }[] | undefined;
  if (workflows?.some(workflow => !workflow.script_name)) {
    next.workflows = workflows.filter(workflow => workflow.script_name);
    changed = true;
  }
  if ("migrations" in next) {
    delete next.migrations;
    changed = true;
  }
  return { section: next, changed };
}

async function startToolingPlatform(
  context: Pick<ORMToolingContext, "cwd" | "environment" | "target">,
  resolved: ResolvedCloudflareConfig,
  configPath: string,
) {
  let proxyConfigPath = configPath;
  if (configPath === resolved.configPath) {
    const { env, ...top } = resolved.raw;
    const stripped = withoutWorkerOwnedClasses(top);
    let changed = stripped.changed;
    const environments = env && Object.fromEntries(Object.entries(env).map(([name, section]) => {
      const result = withoutWorkerOwnedClasses(section);
      changed ||= result.changed;
      return [name, result.section];
    }));
    if (changed) {
      // Stay next to the original so relative paths and .dev.vars resolve the same way.
      proxyConfigPath = join(dirname(configPath), `.wrangler.cossack-tooling-${crypto.randomUUID()}.json`);
      await writeFile(proxyConfigPath, JSON.stringify({ ...stripped.section,
        ...(environments ? { env: environments } : {}) }), { mode: 0o600 });
    }
  }
  try {
    return await resolved.wrangler.getPlatformProxy({ configPath: proxyConfigPath,
      // An isolated config (remote D1) has no environments to select.
      ...(configPath === resolved.configPath && context.environment ? { environment: context.environment } : {}),
      remoteBindings: context.target === "remote",
      persist: context.target === "remote" ? false : { path: join(context.cwd, ".wrangler/state/v3") },
    });
  } finally {
    // The proxy has read its config; remove the temporary file immediately.
    if (proxyConfigPath !== configPath) await rm(proxyConfigPath, { force: true });
  }
}

export interface CloudflareToolingPlatform<Env = Record<string, unknown>> {
  readonly env: Env;
  dispose(): Promise<void>;
}

export interface CloudflareToolingPlatformOptions {
  readonly configPath?: string;
  /** Test/integration injection; production resolves Wrangler from context.cwd. */
  readonly wrangler?: ToolingWrangler;
}

/**
 * Start Wrangler's platform proxy for ORM tooling. Use the returned env to read
 * bindings and dev vars, and call dispose() when the tooling adapter closes.
 */
export async function createCloudflareToolingPlatform<Env = Record<string, unknown>>(
  context: ORMToolingContext, options: CloudflareToolingPlatformOptions = {},
): Promise<CloudflareToolingPlatform<Env>> {
  const resolved = await readCloudflareConfig(context, options);
  const platform = await startToolingPlatform(context, resolved, resolved.configPath);
  return platform as CloudflareToolingPlatform<Env>;
}

export interface D1ToolingBinding {
  readonly binding: string;
  readonly accountId?: string;
  readonly databaseName?: string;
  readonly databaseId?: string;
}

/** Shared CLI/Studio discovery, with Wrangler's environment and config semantics. */
export async function readD1ToolingBindings(
  context: Pick<ORMToolingContext, "cwd" | "environment">,
  options: Pick<D1ToolingOptions, "configPath" | "wrangler"> = {},
): Promise<readonly D1ToolingBinding[]> {
  const { config } = await readCloudflareConfig(context, options);
  return config.d1_databases.map(database => ({ binding: database.binding,
    ...(config.account_id ? { accountId: config.account_id } : {}),
    ...(database.database_name ? { databaseName: database.database_name } : {}),
    ...(database.database_id ? { databaseId: database.database_id } : {}),
  }));
}

/** Select an actual local D1 simulator or a remote D1 binding using project Wrangler. */
export async function createD1ToolingAdapter(
  context: ORMToolingContext, options: D1ToolingOptions = {},
): Promise<Adapter> {
  const resolved = await readCloudflareConfig(context, options);
  const { config } = resolved;
  let configPath = resolved.configPath;
  const bindingName = options.binding ?? "DB";
  const database = config.d1_databases.find(binding => binding.binding === bindingName);
  if (!database) throw new ConfigurationError(`D1 binding "${bindingName}" is not configured for this environment.`);
  const tooling: NonNullable<Adapter["tooling"]> = { provider: "d1", target: context.target,
    ...(config.account_id ? { accountId: config.account_id } : {}),
    ...(context.environment ? { environment: context.environment } : {}), binding: bindingName,
    ...(database.database_name ? { databaseName: database.database_name } : {}),
    ...(database.database_id ? { databaseId: database.database_id } : {}) };
  let temporaryDirectory: string | undefined;
  if (context.target === "remote") {
    if (!database.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(database.database_id)) {
      throw new ConfigurationError(`Remote D1 tooling requires a real database_id for ${bindingName}. Deploy/provision the database first.`);
    }
    // remoteBindings enables remote support but does not force a binding to
    // remote. Use an isolated config with remote:true for exactly this binding.
    temporaryDirectory = join(context.cwd, ".wrangler", "cossack-tooling", crypto.randomUUID());
    configPath = join(temporaryDirectory, "wrangler.json");
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(configPath, JSON.stringify({ name: config.name ?? "cossack-tooling",
      ...(config.account_id ? { account_id: config.account_id } : {}),
      ...(config.main ? { main: config.main } : {}),
      compatibility_date: config.compatibility_date,
      compatibility_flags: config.compatibility_flags,
      d1_databases: [{ ...database, remote: true }],
    }), { mode: 0o600 });
  }
  let platform: Awaited<ReturnType<ToolingWrangler["getPlatformProxy"]>>;
  try {
    platform = await startToolingPlatform(context, resolved, configPath);
  } finally {
    // The proxy has read its config; remove the temporary file immediately.
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  }
  try {
    const binding = platform.env[bindingName] as D1DatabaseBinding | undefined;
    if (!binding || typeof binding.prepare !== "function" || typeof binding.batch !== "function") {
      throw new ConfigurationError(`Wrangler did not provide D1 binding "${bindingName}".`);
    }
    const adapter = await d1(binding);
    const close = adapter.driver.close.bind(adapter.driver);
    let closed = false;
    adapter.driver.close = async () => {
      if (closed) return;
      closed = true;
      try { await close(); } finally { await platform.dispose(); }
    };
    return { ...adapter, tooling };
  } catch (cause) { await platform.dispose(); throw cause; }
}
