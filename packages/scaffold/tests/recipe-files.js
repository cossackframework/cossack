import { readManifest, renderRecipe, resolveManifestRecipe } from '../src/index.js';

/**
 * What the project's recorded recipe renders: each path and the capability it belongs to.
 * A project records no files, so tests ask the recipe which ones are the scaffold's.
 */
export async function recipeCapabilities(root) {
  const rendered = await renderRecipe(resolveManifestRecipe(await readManifest(root)), { projectName: 'app' });
  return Object.fromEntries([...rendered].filter(([, entry]) => entry.capability !== 'local-environment').map(([rel, entry]) => [rel, entry.capability]));
}

/** The paths the recipe renders, sorted. */
export async function recipeFiles(root) {
  return Object.keys(await recipeCapabilities(root)).sort();
}
