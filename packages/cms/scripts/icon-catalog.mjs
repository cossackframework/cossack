// Writes src/icon-catalog.ts: every icon of the installed @cossackframework/solar-icons by
// category, for the icon picker and for checking icon fields on write. The categories are
// Solar's own, as Iconify publishes them (api.iconify.design/collection?prefix=solar), vendored
// in scripts/solar-categories.json as base names (the style suffixes removed); an installed icon
// Iconify does not place goes under Other, and a vendored name the package lacks is left out.
// Run `pnpm --filter @cossackframework/cms icons` after updating either; icon-catalog.test.ts
// fails while the file is stale.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconNames } from '@cossackframework/solar-icons/registry';

/** The installed icon package's version: its package.json is not exported, so it is read beside the registry module. */
async function installedVersion() {
    let directory = dirname(fileURLToPath(import.meta.resolve('@cossackframework/solar-icons/registry')));
    for (let depth = 0; depth < 4; depth++, directory = dirname(directory)) {
        const manifest = await readFile(join(directory, 'package.json'), 'utf8').catch(() => null);
        if (manifest && JSON.parse(manifest).name === '@cossackframework/solar-icons') return JSON.parse(manifest).version;
    }
    throw new Error('@cossackframework/solar-icons: package.json not found');
}

/** `Text Formatting` → `text-formatting`; `Business, Statistic` → `business-statistic`. */
export const categoryId = label => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The catalog as `{ version, categories: [{ id, label, names }] }`, from the installed package and the vendored categories. */
export async function catalog() {
    const version = await installedVersion();
    const vendored = JSON.parse(await readFile(new URL('./solar-categories.json', import.meta.url), 'utf8'));
    const installed = new Set(iconNames);
    const placed = new Set();
    const categories = [];
    for (const [label, names] of Object.entries(vendored)) {
        const present = names.filter(name => installed.has(name) && !placed.has(name)).sort();
        for (const name of present) placed.add(name);
        if (present.length) categories.push({ id: categoryId(label), label, names: present });
    }
    const other = iconNames.filter(name => !placed.has(name)).sort();
    if (other.length) categories.push({ id: 'other', label: 'Other', names: other });
    categories.sort((a, b) => a.id === 'other' ? 1 : b.id === 'other' ? -1 : a.label.localeCompare(b.label));
    return { version, categories };
}

export function render({ version, categories }) {
    const lines = categories.map(category => `    { id: ${JSON.stringify(category.id)}, label: ${JSON.stringify(category.label)}, names: [${category.names.map(name => `'${name}'`).join(', ')}] },`);
    return `/**
 * Every icon of @cossackframework/solar-icons ${version} by Solar's category, written by
 * scripts/icon-catalog.mjs; do not edit. The picker browses it and \`field.icon()\` values are
 * checked against it. A test keeps it in step with the installed package.
 */

export interface IconCategory {
    readonly id: string;
    readonly label: string;
    readonly names: readonly string[];
}

/** The version of the icon package the catalog and the sprites were made from. */
export const ICON_SET_VERSION = ${JSON.stringify(version)};

export const ICON_CATEGORIES: readonly IconCategory[] = Object.freeze([
${lines.join('\n')}
]);
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const result = await catalog();
    await writeFile(new URL('../src/icon-catalog.ts', import.meta.url), render(result));
    console.log(`wrote ${result.categories.length} categories, ${result.categories.reduce((sum, category) => sum + category.names.length, 0)} icons of solar-icons ${result.version}`);
}
