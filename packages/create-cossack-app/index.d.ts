/**
 * Programmatic API for create-cossack-app.
 */

export interface CreateAppOptions {
  /** Target runtime. When omitted, an interactive prompt is shown. */
  adapter?: 'cloudflare' | 'node';
}

export interface CreateAppResult {
  /** Absolute path to the created project directory. */
  projectDir: string;
  /** The adapter the project was configured for. */
  adapter: string;
  /** Path to the written `.cossack/scaffold.json` drift-detection manifest. */
  manifestPath: string;
}

/**
 * Scaffold a new Cossack project at `<cwd>/<projectName>`.
 */
export declare function createApp(
  projectName: string,
  options?: CreateAppOptions,
): Promise<CreateAppResult>;
