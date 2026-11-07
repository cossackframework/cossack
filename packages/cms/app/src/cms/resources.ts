import { contentModule, formsModule, type ResourceDeclaration } from '@cossackframework/cms';

/**
 * Code-declared resources, stored in strict RomeDB collections, such as an `app/leads`
 * resource with `defineResource`. Change a declaration, then apply the plan from
 * /dashboard/tools/schema. Content types made in the dashboard are collections instead:
 * Collections in the dashboard defines them and their fields.
 */
export const resources: ResourceDeclaration[] = [];

/** Built-in modules: posts, pages, categories, tags and the core blocks; forms and their input blocks. Plugins add their own. */
export const modules = [contentModule, formsModule];
