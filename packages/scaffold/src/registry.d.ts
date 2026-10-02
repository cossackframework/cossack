/** Pure recipe metadata: no prompts, filesystem access, or dependency resolution. */
export {
  ADAPTERS, FEATURES, AUTH_METHODS, OAUTH_PROVIDERS, UI_THEMES,
  DASHBOARD_MODULES, FEATURE_REGISTRY, PRESET_REGISTRY, DATABASE_PROVIDERS,
  parseList, resolveFeatures, removeFeature, resolveDashboardModules, resolveRecipe,
} from './index.js';
export type {
  Adapter, Preset, Feature, AuthMethod, DatabaseProvider, OAuthProvider,
  UITheme, DashboardModule, ScaffoldRecipe, CreateAppOptions,
} from './index.js';
