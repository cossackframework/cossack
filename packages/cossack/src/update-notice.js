const DEFAULT_REGISTRY = 'https://registry.npmjs.org/';

function latestVersionUrl(registry) {
  try {
    const url = new URL(String(registry || DEFAULT_REGISTRY).trim());
    if (!url.pathname.endsWith('/')) url.pathname += '/';
    return new URL('cossack/latest', url).href;
  } catch {
    return new URL('cossack/latest', DEFAULT_REGISTRY).href;
  }
}

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(
    String(value ?? '').trim(),
  );
  if (!match) return undefined;
  return {
    numbers: match.slice(1, 4).map(Number),
    prerelease: match[4],
  };
}

export function isNewerVersion(latest, current) {
  const left = parseVersion(latest);
  const right = parseVersion(current);
  if (!left || !right) return false;
  for (let index = 0; index < left.numbers.length; index++) {
    if (left.numbers[index] !== right.numbers[index]) {
      return left.numbers[index] > right.numbers[index];
    }
  }
  return right.prerelease !== undefined && left.prerelease === undefined;
}

export async function checkForCossackUpdate(
  currentVersion,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 1000,
    registry = process.env.npm_config_registry ??
      process.env.NPM_CONFIG_REGISTRY,
  } = {},
) {
  if (typeof fetchImpl !== 'function') return undefined;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    const response = await fetchImpl(latestVersionUrl(registry), {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const latest = (await response.json())?.version;
    return isNewerVersion(latest, currentVersion) ? latest : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
