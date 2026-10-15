import { describe, expect, it, vi } from 'vitest';

// Load the components as browser code so @Client methods retain their bodies.
Object.defineProperty(globalThis, 'window', {
  value: { document: {} },
  configurable: true,
});

const { SettingsPanel } = await import('../src/blocks/index');

describe('@cossackframework/ui/blocks interactions', () => {
  it('reports setting changes', async () => {
    const onValuesChange = vi.fn();
    const settings = new SettingsPanel() as unknown as {
      props: Record<string, unknown>;
      updateValue(key: string, value: boolean | string, control: { matches: () => boolean; readOnly: boolean }): void;
    };
    settings.props = { id: 'settings', sections: [{ id: 'account', title: 'Account', rows: [{ key: 'email', label: 'Email', type: 'switch' }] }], onValuesChange };
    settings.updateValue('email', true, { matches: () => false, readOnly: false });
    expect(onValuesChange).toHaveBeenCalledWith({ email: true });
  });

});
