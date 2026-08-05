import { resolveLinuxOzonePlatform } from './platform.js';

export function isSuccessfulBuildOutput(value: string): boolean {
  return /built in \d|built in [\d.]+s/i.test(value);
}

export interface SandboxHelperMetadata {
  uid: number;
  mode: number;
}

/** Use Electron's testing-only fallback only when the Linux SUID helper cannot work. */
export function developmentSandboxArgs(
  platform: NodeJS.Platform,
  helper: SandboxHelperMetadata | undefined,
): string[] {
  if (platform !== 'linux') return [];
  const isRootOwnedSetuid = helper?.uid === 0 && (helper.mode & 0o4000) !== 0;
  return isRootOwnedSetuid ? [] : ['--no-sandbox'];
}

export function developmentGraphicsArgs(
  platform: NodeJS.Platform,
  environment: Record<string, string | undefined>,
): string[] {
  if (platform !== 'linux') return [];
  const args: string[] = [];
  const ozonePlatform = resolveLinuxOzonePlatform(platform, environment);
  if (ozonePlatform) args.push(`--ozone-platform=${ozonePlatform}`);
  if (environment.COSSACK_DESKTOP_DEBUG !== '1') args.push('--log-level=3');
  return args;
}
