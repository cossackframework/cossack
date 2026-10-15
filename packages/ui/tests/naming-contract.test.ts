// The README "State props and callback names" rule: state x proposes changes
// through onXChange, other callbacks are named after their event, no component
// prop is called onChange, and hover timing is openDelay/closeDelay.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, it } from 'vitest';

const root = join(__dirname, '..', 'src');
function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? sources(path) : entry.name.endsWith('.ts') ? [path] : [];
    });
}
const files = ['components', 'blocks', 'internal'].flatMap(folder => sources(join(root, folder)));
// Callbacks for events that do not report state.
const events = new Set(['onSelect', 'onAction', 'onSubmit', 'onSocial', 'onComplete', 'onNavigate', 'onRetry', 'onRemove',
    'onImageLoad', 'onImageError', 'onSuccess', 'onExpired', 'onError', 'onClick']);
// State that a component reports but never accepts as a prop.
const reportedOnly: Record<string, string[]> = { 'components/Turnstile.ts': ['token'] };

it('scans every component, block and internal helper', () => {
    expect(files.length).toBeGreaterThan(60);
});

it.each(files.map(file => [relative(root, file), file]))('%s names change callbacks after their state', (name, file) => {
    const source = readFileSync(file, 'utf8');
    for (const [, callback] of source.matchAll(/\b(on[A-Z][A-Za-z]*)\??:\s*\(/g)) {
        if (events.has(callback)) continue;
        expect(callback, `${name}: ${callback}`).toMatch(/^on[A-Z][A-Za-z]*Change$/);
        expect(callback, name).not.toBe('onChange');
        const state = callback[2].toLowerCase() + callback.slice(3, -'Change'.length);
        if (!reportedOnly[name]?.includes(state)) expect(source, `${name}: ${callback} needs a ${state} prop`).toMatch(new RegExp(`\\b${state}\\??:`));
    }
    expect(source, name).not.toMatch(/\b(?:hoverDelay|delay)\??:/);
});
