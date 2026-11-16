import { describe, expect, it } from 'vitest';
import { activeSettingsSection } from '../src/cms/settings-scroll';

describe('settings scroll navigation', () => {
    const sections = [{ id: 'general', top: -400 }, { id: 'media', top: 120 }, { id: 'plugin:gallery', top: 600 }];

    it('follows the reading line beneath the toolbar, including taller mobile toolbars', () => {
        expect(activeSettingsSection(sections, 80, false)).toBe('general');
        expect(activeSettingsSection(sections, 144, false)).toBe('media');
        expect(activeSettingsSection(sections, 600, false)).toBe('plugin:gallery');
        expect(activeSettingsSection(sections, 80, false)).toBe('general');
    });

    it('selects the final short section at the bottom of the document', () => {
        expect(activeSettingsSection(sections, 80, true)).toBe('plugin:gallery');
    });

    it('uses only the remaining search results and tolerates an empty result set', () => {
        expect(activeSettingsSection([{ id: 'plugin:gallery', top: 320 }], 80, false)).toBe('plugin:gallery');
        expect(activeSettingsSection([], 80, false)).toBeUndefined();
        expect(activeSettingsSection([], 80, true)).toBeUndefined();
    });
});
