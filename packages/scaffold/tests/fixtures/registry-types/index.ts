import { resolveRecipe, recipeCapabilityDiagnostics, recipeCapabilityRequirements } from '@cossackframework/scaffold/registry';
import type { Feature, ScaffoldRecipe } from '@cossackframework/scaffold/registry';
const features: Feature[] = ['resource', 'mutation', 'scoped-service', 'protected-route'];
const recipe: ScaffoldRecipe = resolveRecipe({ adapter: 'cloudflare', preset: 'minimal', features });
recipeCapabilityRequirements(recipe);
recipeCapabilityDiagnostics(recipe);
// @ts-expect-error Unknown recipes must not silently widen to string.
resolveRecipe({ features: ['not-a-feature'] });
// @ts-expect-error The pure registry must not introduce Node globals.
Buffer.from('no Node types');
