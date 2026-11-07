import { describe, expect, it, vi } from 'vitest';
import { SettingsSection } from '../src/cms/settings-section';

function section(onConnect: (id: string, element: Element | undefined) => void) {
    const result = new SettingsSection();
    result.props = { id: 'general', heading: null as never, content: () => null as never, onConnect };
    return result;
}

describe('settings section teardown', () => {
    it('does not notify the page on the server, where onConnect is a client method', () => {
        const onConnect = vi.fn();
        // Node is the server: teardown after rendering must not reach the client-method proxy.
        section(onConnect).onCleanup();
        expect(onConnect).not.toHaveBeenCalled();
    });

    it('releases its element with the page in the browser', () => {
        const onConnect = vi.fn();
        const instance = section(onConnect);
        (instance as unknown as { isServer: boolean }).isServer = false;
        instance.onCleanup();
        expect(onConnect).toHaveBeenCalledWith('general', undefined);
    });
});
