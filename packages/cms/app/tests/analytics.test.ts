import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { analyticsTags, NO_ANALYTICS } from '../src/cms/analytics';

/** Runs Google's tag as a page would, `times` over, and reports what it loaded. */
function runGoogle(script: string, navigator: object, times = 1) {
    const loaded: { src?: string; async?: boolean }[] = [];
    const page: Record<string, unknown> = { navigator, document: { createElement: () => ({}), head: { appendChild: (element: { src?: string }) => loaded.push(element) } } };
    page.window = page;
    vm.createContext(page);
    for (let run = 0; run < times; run++) vm.runInContext(script, page);
    return { loaded, layer: (page.dataLayer ?? []) as unknown[] };
}

describe('analytics services', () => {
    it('adds nothing until a service is named', () => {
        expect(analyticsTags(NO_ANALYTICS)).toEqual([]);
    });

    it("adds Cloudflare's script with the token", () => {
        expect(analyticsTags({ ...NO_ANALYTICS, cloudflareToken: 'abc123' })).toEqual([{
            tag: 'script',
            attributes: { defer: '', src: 'https://static.cloudflareinsights.com/beacon.min.js', 'data-cf-beacon': '{"token":"abc123"}' },
            children: '',
        }]);
    });

    it("starts Google's tag once, though the client runs head scripts again on navigation", () => {
        const [tag] = analyticsTags({ ...NO_ANALYTICS, googleMeasurementId: 'G-TEST1234' });
        const { loaded, layer } = runGoogle(tag!.children!, {}, 3);
        expect(loaded).toEqual([{ async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234' }]);
        expect(layer).toHaveLength(2);
    });

    it('leaves Google out for browsers asking not to be tracked', () => {
        const [tag] = analyticsTags({ ...NO_ANALYTICS, googleMeasurementId: 'G-TEST1234' });
        expect(runGoogle(tag!.children!, { globalPrivacyControl: true }).loaded).toEqual([]);
        expect(runGoogle(tag!.children!, { doNotTrack: '1' }).loaded).toEqual([]);
    });

    it('refuses values that could leave the script, whatever is stored', () => {
        expect(analyticsTags({ cloudflareToken: 'a"b', googleMeasurementId: "G-1234';alert(1)//" })).toEqual([]);
        expect(analyticsTags({ cloudflareToken: '', googleMeasurementId: 'UA-1234' })).toEqual([]);
    });
});
