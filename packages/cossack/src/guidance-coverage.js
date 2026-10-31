/** Authored usage families, separate from generated export/symbol facts or runtime proof. */
export const GUIDANCE_FAMILIES = Object.freeze({
  core: {
    'state and validation': ['reactive-state-and-stores', 'reactive-field-validation', 'typed-url-state'],
    'component actions and authorization': ['component-actions', 'validated-input', 'server-action-access-policy'],
    'forms and resources': ['nested-form-input', 'safe-old-input', 'accessible-form-controller', 'server-resources'],
    'lifecycle and browser ownership': ['lifecycle-tasks', 'template-head-and-browser-ownership', 'navigation-result-ownership'],
    'services and optimism': ['scoped-services-and-injection', 'optimistic-edits-and-uncertain-rpc'],
    'transport and diagnostics': ['rpc-streams-and-transport-policy', 'realtime-layouts-and-components', 'development-rpc-traces', 'fixed-server-failure-diagnostics'],
    'request and localization': ['request-context-and-signed-values', 'localization-and-worker-isolation', 'route-urls'],
    'storage and provider guarantees': ['authorized-object-storage', 'image-rendering-diagnostics', 'runtime-and-counter-guarantees'],
    'jobs, schedules, notifications and workflows': ['background-jobs-runtime', 'schedule-occurrence-jobs', 'notification-templates-preferences', 'local-workflow-lifecycle'],
  },
  renderer: {
    'templates, forms, lists and CSS': ['server-html', 'conditional-templates', 'keyed-lists', 'server-form-values', 'safe-component-css'],
    'component tags and template checks': ['component-tags', 'binding-forms-and-template-checks'],
  },
  framework: {
    'configuration, capabilities and cache': ['request-scoped-configuration', 'runtime-capability-planning', 'cache-storage-guarantees'],
    'HTTP, sessions and tooling': ['typed-http-boundaries', 'request-session-store', 'routing-api-render-tooling', 'read-only-project-inspection'],
    'locale and static generation': ['localized-static-rendering'],
    'cloud storage and workflows': ['authorized-cloud-object-storage', 'workflow-binding-client'],
    'durable jobs and notifications': ['durable-job-ledger', 'notification-providers-durable-store'],
  },
  'node-adapter': { 'native lifecycle, SMTP and storage': ['node-runtime-lifecycle', 'notification-smtp-adapter', 'authorized-local-storage'] },
  auth: { 'sessions, credentials, policies, OAuth and Turnstile': ['session-and-role-guards', 'credential-and-session-primitives', 'resource-policies', 'oauth-failure-stages', 'turnstile-server-verification'] },
  database: { 'adapters, typed queries, migrations, seeders and transactions': ['parameterized-node-sqlite', 'cloudflare-d1-bound-query', 'typed-model-queries', 'node-sqlite-migrations-and-seeding', 'node-sqlite-transaction-rollback'] },
  scaffold: { 'all recipe registries and conflict-safe composition': ['recipe-registry-planning', 'conflict-safe-composition', 'resource-recipe', 'mutation-recipe', 'scoped-service-recipe', 'protected-route-recipe'] },
  studio: { 'provider selection and embedded lifecycle': ['safe-studio-workflows'] },
  romedb: { 'request bindings, typed values and RomeQL ledgers': ['romedb-request-binding', 'romedb-typed-values', 'romedb-rql-ledgers'] },
  cms: {
    'resources, repositories and collections': ['cms-resources', 'cms-repositories', 'cms-collections', 'cms-field-groups'],
    'publishing, forms and appearance': ['cms-publishing', 'cms-forms', 'cms-appearance'],
    'plugins, auth and stores': ['cms-plugins', 'cms-auth-and-stores'],
  },
  'typescript-plugin': { 'editor diagnostics and completions': ['editor-template-checks'] },
  ui: { 'typed native controls and all component families': ['native-controls', 'radio-and-range', 'one-time-code', 'searchable-combobox', 'tag-multi-select', 'gregorian-date-controls', 'native-modal-dialogs', 'native-popover', 'action-menus', 'hover-content', 'alert-confirmation', 'modal-command-search', 'native-disclosures', 'typed-tabs', 'native-toggles', 'native-menubar', 'native-navigation', 'native-pagination', 'native-breadcrumb', 'native-layout', 'native-display', 'native-status', 'native-field-empty', 'native-avatar', 'native-typography-item', 'native-table-scroll-area', 'native-resizable', 'native-sidebar', 'native-toast', 'native-carousel', 'native-attachment', 'native-chat-display', 'native-message-scroller', 'native-icon', 'native-auth-form', 'composed-command-palette', 'server-data-table', 'native-dashboard-stat', 'native-settings-panel', 'turnstile-widget-lifecycle'] },
});

export function describeGuidanceCoverage(name, guidance) {
  const families = GUIDANCE_FAMILIES[name.replace('@cossackframework/', '')];
  if (!families) return { status: 'not-enumerated', behaviorVerification: 'not-performed', families: [] };
  const available = new Set(guidance.guides.map(guide => guide.id));
  const entries = Object.entries(families).map(([family, guides]) => ({family, guides, missing: guides.filter(id => !available.has(id))}));
  return {status: entries.some(entry => entry.missing.length) ? 'partial' : 'available',
    behaviorVerification: 'not-performed', families: entries};
}
