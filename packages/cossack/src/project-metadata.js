import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, resolveManifestRecipe, FEATURE_REGISTRY, recipeCapabilityRequirements, recipeCapabilityDiagnostics } from '@cossackframework/scaffold';

/** Recorded recipe facts only. Never expose arbitrary manifest config or values. */
export async function inspectScaffoldMetadata(root) {
  let source = '.cossack/scaffold.json';
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(path.join(root, source), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') return invalid();
  }
  // A project that records no scaffold files keeps its recipe in package.json.
  const recorded = await readManifest(root);
  if (recorded?.recordsFiles === false) { manifest = recorded; source = 'package.json'; }
  if (!manifest) return { status: 'unrecorded', source, recipe: null, diagnostics: [] };
  try {
    const recipe = resolveManifestRecipe(manifest);
    return {
      status: 'recorded', source,
      recipe: {
        runtime: recipe.adapter,
        explicitFeatures: recipe.explicitFeatures,
        features: recipe.resolvedFeatures.map(name => ({ name, requires: FEATURE_REGISTRY[name].requires })),
        dashboardModules: recipe.dashboardModules,
        capabilityRequirements: {
          web: recipeCapabilityRequirements(recipe),
          ...(recipe.resolvedFeatures.includes('desktop') ? { desktop: recipeCapabilityRequirements(recipe, 'desktop') } : {}),
        },
        config: recipe.config,
      },
      diagnostics: recipeCapabilityDiagnostics(recipe).map(diagnostic => ({
        ...diagnostic, severity: 'error', source: diagnostic.source.file,
      })),
    };
  } catch { return invalid(); }
  function invalid() {
    return { status: 'invalid', source, recipe: null, diagnostics: [{
      code: 'COSSACK_SCAFFOLD_METADATA_INVALID', severity: 'error', source,
      message: 'Recorded scaffold metadata is invalid or unsupported.',
    }] };
  }
}
