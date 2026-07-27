import { describe, expect, it, vi } from 'vitest';

// Load the components as browser code so @Client methods retain their bodies.
Object.defineProperty(globalThis, 'window', {
  value: { document: {} },
  configurable: true,
});

const { AuthForm, CommandPalette, SettingsPanel } = await import('../src/blocks/index');

describe('@cossackframework/ui/blocks interactions', () => {
  it('submits valid auth data and reports setting changes', async () => {
    const onSubmit = vi.fn();
    const auth = new AuthForm() as unknown as {
      props: Record<string, unknown>;
      email: string;
      password: string;
      handleSubmit(event: Event): Promise<void>;
    };
    auth.props = { onSubmit, social: false };
    auth.email = 'ada@example.com';
    auth.password = 'correct-horse';
    await auth.handleSubmit(new Event('submit', { cancelable: true }));
    expect(onSubmit).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct-horse',
      name: undefined,
    });

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
