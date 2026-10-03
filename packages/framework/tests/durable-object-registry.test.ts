import 'reflect-metadata';
import { expect, it, vi } from 'vitest';
import { Cossack } from '@cossackframework/core';
const { source } = vi.hoisted(() => ({ source: { pages: {} as Record<string, unknown>, layouts: {} as Record<string, unknown>, loadings: {} } }));
vi.mock('virtual:cossack-pages', () => ({ default: source }));
import { AppDurableObject } from '../src/DurableObject';

class GeneratedPage extends Cossack {}
class GeneratedLayout extends Cossack {}
class NamedHelper extends Cossack {}
source.pages['/src/pages/(app)/rooms/[id]/index.ts'] = { AHelper: NamedHelper, default: GeneratedPage };
source.pages['/src/pages/api/count.ts'] = { GET: () => new Response('count') };
source.pages['/src/pages/api/class.ts'] = { default: class OrdinaryHandler {} };
source.pages['/src/pages/missing/index.ts'] = { NamedHelper };
source.layouts['/src/pages/(app)/layout.ts'] = { AHelper: NamedHelper, default: GeneratedLayout };

it('resolves generated page and layout socket targets through the compiler registry', async () => {
    // Registry lookup requires neither a platform constructor nor storage I/O.
    const object = Object.create(AppDurableObject.prototype) as AppDurableObject;
    expect([...await object.getComponentRegistry()]).toEqual([
        ['/src/pages/(app)/rooms/[id]/index.ts', GeneratedPage],
        ['/src/pages/(app)/layout.ts', GeneratedLayout],
    ]);
});
