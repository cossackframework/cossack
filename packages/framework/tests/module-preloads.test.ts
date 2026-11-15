import { describe, expect, it, vi } from 'vitest';
import { getModulePreloads } from '../src/route-ids';

/** A build manifest: the entry, a page, the layout it renders in, and what each imports. */
const manifest = {
    'src/client/entry-client.ts': { file: 'assets/entry-client.js', imports: ['_store.js'] },
    '_store.js': { file: 'assets/store.js' },
    'src/pages/(site)/index.ts': { file: 'assets/page.js', imports: ['_store.js', '_view.js'] },
    '_view.js': { file: 'assets/view.js' },
    'src/pages/(site)/layout.ts': { file: 'assets/layout.js', imports: ['_view.js', '_taskbar.js'] },
    '_taskbar.js': { file: 'assets/taskbar.js', imports: ['_tooltip.js'] },
    '_tooltip.js': { file: 'assets/tooltip.js' },
};

describe('module preloads', () => {
    vi.stubEnv('DEV', false);

    it("preload the page's layouts and what they import, not only the page", () => {
        const hrefs = getModulePreloads(manifest, '/src/pages/(site)/index.ts', ['/src/pages/(site)/layout.ts']);
        expect(hrefs).toEqual(expect.arrayContaining(['/assets/page.js', '/assets/view.js', '/assets/layout.js', '/assets/taskbar.js', '/assets/tooltip.js', '/assets/store.js']));
        // Each once, and never the entry the page's script tag already names.
        expect(new Set(hrefs).size).toBe(hrefs.length);
        expect(hrefs).not.toContain('/assets/entry-client.js');
    });

    it('preload the page alone without layouts', () => {
        expect(getModulePreloads(manifest, '/src/pages/(site)/index.ts')).not.toContain('/assets/layout.js');
    });
});
