import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JavaScript build script
import { palettesCss, palettesModule } from '../scripts/build-palettes.mjs';
import { UI_PALETTES } from '../src/index';

describe('runtime palettes', () => {
    it('are in step with the palette files (run `pnpm --filter @cossackframework/ui palettes`)', async () => {
        expect(await readFile(new URL('../src/theme/palettes.css', import.meta.url), 'utf8')).toBe(await palettesCss());
        expect(await readFile(new URL('../src/theme/palettes.ts', import.meta.url), 'utf8')).toBe(await palettesModule());
    });

    it('scope every palette but neutral to the page choice, accents after bases, dark mode complete', async () => {
        const css = await palettesCss();
        expect(css).not.toContain('content~="neutral"');
        for (const palette of UI_PALETTES.filter(entry => entry.id !== 'neutral')) {
            expect(css).toContain(`:root:has(> head > meta[name="ui-palette"][content~="${palette.id}"])`);
            expect(css).toContain(`:root.dark[data-palette~="${palette.id}"]`);
        }
        expect(css.indexOf('content~="blue"')).toBeGreaterThan(css.indexOf('content~="stone"'));
        // Zinc's own .dark block leaves the charts alone; scoped, theme.css's dark value is repeated.
        const zincDark = css.slice(css.indexOf(':root.dark[data-palette~="zinc"]'), css.indexOf('/* Gray'));
        expect(zincDark).toContain('--chart-1: oklch(0.488 0.243 264.376);');
        expect(UI_PALETTES.map(palette => `${palette.kind}:${palette.id}`)).toEqual(['base:neutral', 'base:zinc', 'base:gray', 'base:slate', 'base:stone', 'accent:neutral', 'accent:blue', 'accent:green', 'accent:red']);
    });
});
