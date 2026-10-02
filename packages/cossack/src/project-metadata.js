import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveManifestRecipe, FEATURE_REGISTRY } from '@cossackframework/scaffold';

/** Recorded recipe facts only. Never expose arbitrary manifest config or values. */
export async function inspectScaffoldMetadata(root) {
  const source = '.cossack/scaffold.json';
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, source), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'unrecorded', source, recipe: null, diagnostics: [] };
    return invalid();
  }
  try {
    const recipe = resolveManifestRecipe(manifest);
    return {
      status: 'recorded', source,
      recipe: {
        runtime: recipe.adapter,
        explicitFeatures: recipe.explicitFeatures,
        features: recipe.resolvedFeatures.map(name => ({ name, requires: FEATURE_REGISTRY[name].requires })),
        dashboardModules: recipe.dashboardModules,
        config: recipe.config,
      },
      diagnostics: [],
    };
  } catch { return invalid(); }
  function invalid() {
    return { status: 'invalid', source, recipe: null, diagnostics: [{
      code: 'COSSACK_SCAFFOLD_METADATA_INVALID', severity: 'error', source,
      message: 'Recorded scaffold metadata is invalid or unsupported.',
    }] };
  }
}
