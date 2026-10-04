import { describe, expect, it, vi } from 'vitest';

// Load the components as browser code so @Client methods retain their bodies.
Object.defineProperty(globalThis, 'window', {
  value: { document: {} },
  configurable: true,
});

const { CommandPalette, SettingsPanel } = await import('../src/blocks/index');

describe('@cossackframework/ui/blocks interactions', () => {
  it('reports setting changes', async () => {
    const onChange = vi.fn();
    const settings = new SettingsPanel() as unknown as {
      props: Record<string, unknown>;
      updateValue(key: string, value: boolean | string): void;
    };
    settings.props = { sections: [], onChange };
    settings.updateValue('email', true);
    expect(onChange).toHaveBeenCalledWith({ email: true });
  });

  it('selects commands and closes the palette', () => {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    const palette = new CommandPalette() as unknown as {
      props: Record<string, unknown>;
      select(id: string): void;
    };
    palette.props = {
      commands: [{ id: 'settings', label: 'Settings' }],
      onSelect,
      onOpenChange,
    };
    palette.select('settings');
    expect(onSelect).toHaveBeenCalledWith('settings');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
