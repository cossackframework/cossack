import { builtinModules } from 'node:module';
import { checkCapabilityRequirements } from '@cossackframework/core/runtime-capabilities';

export const ADAPTERS = ['cloudflare', 'node'];
export const FEATURES = ['ui', 'database', 'studio', 'auth', 'dashboard', 'markdown', 'examples', 'desktop', 'resource', 'mutation', 'scoped-service', 'protected-route', 'jobs', 'turnstile', 'schedules', 'notifications', 'workflows', 'cms'];
export const AUTH_METHODS = ['credentials', 'oauth'];
export const OAUTH_PROVIDERS = ['github', 'google', 'gitlab', 'facebook', 'microsoft'];
export const UI_THEMES = ['default', 'neutral', 'zinc', 'stone', 'gray', 'slate', 'blue', 'green', 'red'];
export const DASHBOARD_MODULES = ['users', 'sessions', 'settings', 'roles'];

const WORKER_NAME = /^[a-z0-9-]+$/;

/**
 * Why `name` cannot be a project name, or null when it can. A project name is
 * both the package.json name and the Cloudflare Worker name, so it follows the
 * stricter of the two rules: 1-63 lowercase letters, digits and dashes that do
 * not start or end with a dash, and not a Node.js built-in module name.
 */
export function projectNameProblem(name) {
  if (typeof name !== 'string' || name.length === 0) return 'The project name is empty.';
  if (name.length > 63) return 'The project name must be 63 characters or fewer (Cloudflare Worker name limit).';
  if (name !== name.toLowerCase() && WORKER_NAME.test(name.toLowerCase())) return 'The project name must be lowercase.';
  if (!WORKER_NAME.test(name)) return 'The project name may contain only lowercase letters, digits and dashes.';
  if (name.startsWith('-') || name.endsWith('-')) return 'The project name must start and end with a letter or digit.';
  if (builtinModules.includes(name)) return `The project name "${name}" is a Node.js built-in module name.`;
  return null;
}

export const FEATURE_REGISTRY = {
  ui: { requires: [] },
  database: { requires: [] },
  studio: { requires: ['database'] },
  auth: { requires: ['ui', 'database'] },
  dashboard: { requires: ['auth'] },
  markdown: { requires: [] },
  examples: { requires: ['ui', 'markdown'] },
  desktop: { requires: [] },
  resource: { requires: [] },
  mutation: { requires: [] },
  'scoped-service': { requires: [] },
  'protected-route': { requires: ['auth'] },
  jobs: { requires: [] },
  turnstile: { requires: ['ui'] },
  schedules: { requires: ['jobs'] },
  notifications: { requires: ['jobs'] },
  workflows: { requires: [] },
  // FastDB CMS: content, media, taxonomies, settings and plugins in the shared dashboard.
  // With cms, auth keeps users and sessions in FastDB, so it no longer needs database.
  cms: { requires: ['ui', 'auth', 'dashboard'] },
};

/** Features that cannot be selected together, with the reason. */
export const FEATURE_CONFLICTS = [];

/** Where auth keeps users, roles and sessions: the CMS (FastDB) or the ORM (`database`). */
export function authStore(features) {
  return features.includes('cms') ? 'cms' : 'database';
}

function requirementsOf(feature, requested) {
  if (feature === 'auth' && authStore(requested) === 'cms') return ['ui'];
  return FEATURE_REGISTRY[feature].requires;
}

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
  postgres: { adapters: ['node'] },
  mysql: { adapters: ['node'] },
  'hyperdrive-postgres': { adapters: ['cloudflare'] },
  'hyperdrive-mysql': { adapters: ['cloudflare'] },
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
    for (const dependency of requirementsOf(feature, requested)) visit(dependency);
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
  // Studio may add database support to an otherwise data-free project. Removing
  // Studio intentionally leaves that useful setup in place.
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
  for (const conflict of FEATURE_CONFLICTS) {
    if (conflict.features.every(feature => resolvedFeatures.includes(feature))) throw new Error(conflict.reason);
  }

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
  if (authStore(resolvedFeatures) === 'cms' && (authMethods.includes('oauth') || oauth.length)) {
    throw new Error('OAuth sign-in is not available with the cms feature yet. Use --auth-methods credentials.');
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

  const recipe = {
    adapter,
    preset,
    explicitFeatures,
    resolvedFeatures,
    dashboardModules,
    config: {
      database,
      authMethods,
      oauth,
      theme,
    },
  };
  return recipe;
}

/** Host support for all selected targets. Recorded recipes remain inspectable. */
export function recipeCapabilityDiagnostics(recipe) {
  return ['web', ...(recipe.resolvedFeatures.includes('desktop') ? ['desktop'] : [])]
    .flatMap(target => checkCapabilityRequirements(
      target === 'desktop' ? 'desktop' : recipe.adapter,
      recipeCapabilityRequirements(recipe, target),
    )
      // Binding configuration/remote readiness remain build/deploy checks.
      .filter(result => result.code !== 'COSSACK_CAPABILITY_BINDING_MISSING')
      .map(result => ({ ...result, target })));
}

/** Requirements selected by the recipe, separate from discovered page transports. */
export function recipeCapabilityRequirements(recipe, target = 'web') {
  if (target !== 'web' && target !== 'desktop') throw new Error(`Unknown recipe target: ${target}`);
  const requirements = [];
  const add = (feature, requires) => requirements.push({
    feature, source: { file: '.cossack/scaffold.json' }, requires,
  });
  if (recipe.resolvedFeatures.includes('workflows')) add('workflows/cloudflare', { cloudflareBindings: ['WORKFLOWS'] });
  if (recipe.resolvedFeatures.includes('jobs')) add('jobs/cloudflare-queues', { cloudflareBindings: ['JOBS', 'JOB_STATE'] });
  if (recipe.resolvedFeatures.includes('schedules')) add('schedules/cloudflare-cron', { cloudflareBindings: ['JOBS', 'JOB_STATE'] });
  if (recipe.resolvedFeatures.includes('notifications')) add('notifications/cloudflare-email', { cloudflareBindings: ['EMAIL', 'JOB_STATE'] });
  if (recipe.resolvedFeatures.includes('cms')) add('cms', { transports: ['http'], ...(recipe.adapter === 'cloudflare' ? { cloudflareBindings: ['FASTDB_PENDING', 'MEDIA'] } : { filesystem: true }) });
  if (recipe.resolvedFeatures.includes('resource')) add('resource', { transports: ['http'] });
  if (recipe.resolvedFeatures.includes('mutation')) add('mutation', { transports: ['http'] });
  if (recipe.resolvedFeatures.includes('scoped-service')) add('scoped-service', { transports: ['http'] });
  if (recipe.resolvedFeatures.includes('protected-route')) add('protected-route', { transports: ['http'] });
  if (recipe.resolvedFeatures.includes('database') && recipe.config.database === 'sqlite') {
    add('database/sqlite', { filesystem: true });
  }
  if (recipe.resolvedFeatures.includes('database')) {
    if (recipe.config.database === 'd1') add('database/d1', { cloudflareBindings: ['DB'] });
    if (recipe.config.database.startsWith('hyperdrive-')) {
      add(`database/${recipe.config.database}`, { cloudflareBindings: ['HYPERDRIVE'] });
    }
  }
  if (target === 'desktop' && recipe.resolvedFeatures.includes('desktop')) {
    add('desktop', { filesystem: true });
  }
  return requirements;
}
