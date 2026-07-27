export const ADAPTERS = ['cloudflare', 'node'];
export const FEATURES = ['ui', 'database', 'studio', 'auth', 'dashboard', 'markdown', 'examples'];
export const AUTH_METHODS = ['credentials', 'oauth'];
export const OAUTH_PROVIDERS = ['github', 'google', 'gitlab', 'facebook', 'microsoft'];
export const UI_THEMES = ['default', 'neutral', 'zinc', 'stone', 'gray', 'slate', 'blue', 'green', 'red'];
export const DASHBOARD_MODULES = ['users', 'sessions', 'settings', 'roles'];

export const FEATURE_REGISTRY = {
  ui: { requires: [] },
  database: { requires: [] },
  studio: { requires: ['database'] },
  auth: { requires: ['ui', 'database'] },
  dashboard: { requires: ['auth'] },
  markdown: { requires: [] },
  examples: { requires: ['ui', 'markdown'] },
};

export const PRESET_REGISTRY = {
  minimal: { features: [] },
  database: { features: ['database'] },
  auth: { features: ['ui', 'database', 'auth'] },
  'full-stack': {
    features: ['ui', 'database', 'auth', 'dashboard', 'examples'],
    dashboardModules: DASHBOARD_MODULES,
  },
};

export const DATABASE_PROVIDERS = {
  d1: { adapters: ['cloudflare'] },
  sqlite: { adapters: ['node'] },
  turso: { adapters: ADAPTERS },
};

export function parseList(value) {
  if (value === undefined || value === null || value === false || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function assertKnown(values, supported, label) {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) {
    throw new Error(`Duplicate ${label}: ${duplicate}. Supported values: ${supported.join(', ')}`);
  }
  const invalid = values.filter((value) => !supported.includes(value));
  if (invalid.length) {
    throw new Error(`Unknown ${label}(s): ${invalid.join(', ')}. Supported values: ${supported.join(', ')}`);
  }
}

export function resolveFeatures(explicit) {
  const requested = parseList(explicit);
  assertKnown(requested, FEATURES, 'feature');
  const resolved = new Set();
  const visit = (feature) => {
    for (const dependency of FEATURE_REGISTRY[feature].requires) visit(dependency);
    resolved.add(feature);
  };
  for (const feature of requested) visit(feature);
  return FEATURES.filter((feature) => resolved.has(feature));
}

export function removeFeature(explicit, feature) {
  const requested = parseList(explicit);
  assertKnown(requested, FEATURES, 'feature');
  assertKnown([feature], FEATURES, 'feature');
  const selected = new Set(requested.filter((selectedFeature) =>
    !resolveFeatures([selectedFeature]).includes(feature),
  ));
  // Studio may add database support to an otherwise database-free project,
  // but removing Studio intentionally leaves that useful database setup in
  // place. Removing database still removes Studio as its dependent.
  if (feature === 'studio' && requested.includes('studio')) selected.add('database');
  return FEATURES.filter((candidate) => selected.has(candidate));
}

export function resolveDashboardModules(value, dashboardSelected) {
  if (!dashboardSelected) return [];
  const modules = value === undefined ? [...DASHBOARD_MODULES] : parseList(value);
  assertKnown(modules, DASHBOARD_MODULES, 'dashboard module');
  return DASHBOARD_MODULES.filter((module) => modules.includes(module));
}

export function resolveRecipe(options = {}) {
  const adapter = options.adapter ?? options.runtime ?? 'cloudflare';
  if (!ADAPTERS.includes(adapter)) {
    throw new Error(`Unknown adapter "${adapter}". Supported values: ${ADAPTERS.join(', ')}`);
  }

  const preset = options.preset ?? 'full-stack';
  if (!PRESET_REGISTRY[preset]) {
    throw new Error(`Unknown preset "${preset}". Supported values: ${Object.keys(PRESET_REGISTRY).join(', ')}`);
  }

  const presetFeatures = PRESET_REGISTRY[preset].features;
  const optionFeatures = options.features === undefined ? [] : parseList(options.features);
  const explicitFeatures = FEATURES.filter((feature) =>
    [...presetFeatures, ...optionFeatures].includes(feature),
  );
  assertKnown(optionFeatures, FEATURES, 'feature');
  const resolvedFeatures = resolveFeatures(explicitFeatures);

  const database = options.database ??
    (adapter === 'cloudflare' ? 'd1' : 'sqlite');
  if (!DATABASE_PROVIDERS[database]) {
    throw new Error(`Unknown database provider "${database}". Supported values: ${Object.keys(DATABASE_PROVIDERS).join(', ')}`);
  }
  if (!DATABASE_PROVIDERS[database].adapters.includes(adapter)) {
    throw new Error(`Database provider "${database}" is not supported by the ${adapter} adapter`);
  }

  const oauth = parseList(options.oauth);
  assertKnown(oauth, OAUTH_PROVIDERS, 'OAuth provider');
  const authMethods = options.authMethods === undefined
    ? (oauth.length ? ['credentials', 'oauth'] : ['credentials'])
    : parseList(options.authMethods);
  assertKnown(authMethods, AUTH_METHODS, 'auth method');
  if (resolvedFeatures.includes('auth') && authMethods.length === 0) {
    throw new Error(`Select at least one auth method: ${AUTH_METHODS.join(', ')}`);
  }
  if (resolvedFeatures.includes('auth') && authMethods.includes('oauth') && oauth.length === 0) {
    throw new Error(`OAuth authentication requires at least one provider: ${OAUTH_PROVIDERS.join(', ')}`);
  }
  if (!authMethods.includes('oauth') && oauth.length) {
    throw new Error('OAuth providers were configured but the oauth auth method is not enabled');
  }
  const theme = options.theme ?? 'default';
  assertKnown([theme], UI_THEMES, 'UI theme');

  const dashboardValue = options.dashboardModules ?? options.dashboardFeatures ??
    PRESET_REGISTRY[preset].dashboardModules;
  const dashboardModules = resolveDashboardModules(
    dashboardValue,
    resolvedFeatures.includes('dashboard'),
  );

  return {
    adapter,
    preset,
    explicitFeatures,
    resolvedFeatures,
    dashboardModules,
    config: { database, authMethods, oauth, theme },
  };
}
