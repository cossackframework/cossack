export function defaultLangCatalog() {
  return {
    welcome: 'Welcome to :name',
    goodbye: 'Goodbye, :Name',
    apples: 'You have :count apple|You have :count apples',
    'I love programming.': 'I love programming.',
  };
}

/**
 * Starter catalog JSON for a locale. `publish` uses the populated English
 * template; `add <locale>` reuses this with empty strings so translators can
 * fill in values while keeping the key set in sync.
 *
 * @param entries  key → value map (values may be '' for the `add` stub)
 */
export function langJsonTemplate(entries) {
  return JSON.stringify(entries, null, 2) + '\n';
}

// ===========================================================================

