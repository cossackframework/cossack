import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { UI_COMPONENTS } from '../src/templates/ui.js';

afterEach(() => vi.restoreAllMocks());

describe('UI source ejection', () => {
  it.each(['accordion', 'collapsible', 'toaster'])('ejects a complete %s component', (name) => {
    // Resolve the real UI dependency from a workspace application, as the CLI
    // does from a consuming app. This also catches source/catalog name drift.
    vi.spyOn(process, 'cwd').mockReturnValue(fileURLToPath(new URL('../../framework/', import.meta.url)));
    const source = UI_COMPONENTS[name].template();
    expect(source).not.toContain('export {};');
    expect(source).not.toMatch(/from ["']\./);
    expect(source).toContain(name === 'accordion' ? 'class AccordionItem' : `class ${UI_COMPONENTS[name].className}`);
    if (name !== 'toaster') {
      expect(source).toContain('class DisclosureController');
      expect(source).toContain('function disclosureStyle');
    }
  });
});
