import { describe, expect, it } from 'vitest';
import { renderToString } from '@cossackframework/renderer';
import {
  AuthForm,
  CommandPalette,
  DashboardStat,
  SettingsPanel,
} from '../src/blocks/index';

function renderBlock(
  Block: new () => { props: Record<string, unknown>; render(): unknown },
  props: Record<string, unknown>,
): string {
  const instance = new Block();
  instance.props = props;
  return renderToString(instance.render() as never);
}

describe('@cossackframework/ui/blocks', () => {
  it('renders every public block on the server', () => {
    expect(renderBlock(AuthForm, { social: false })).toContain('cs-auth-form');
    expect(renderBlock(CommandPalette, {
      commands: [{ id: 'home', label: 'Home' }],
      open: true,
    })).toContain('cs-command-palette');
    expect(renderBlock(DashboardStat, {
      stats: [{ label: 'Users', value: 42 }],
    })).toContain('Users');
    expect(renderBlock(SettingsPanel, {
      sections: [{
        title: 'Account',
        rows: [{ label: 'Name', type: 'text', key: 'name' }],
      }],
    })).toContain('Account');
  });

  it('imports the compiled blocks without browser event constructors', async () => {
    const names = ['KeyboardEvent', 'MouseEvent', 'PointerEvent', 'InputEvent'] as const;
    const descriptors = new Map(
      names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
    );
    for (const name of names) Reflect.deleteProperty(globalThis, name);
    try {
      await expect(import('@cossackframework/ui/blocks')).resolves.toMatchObject({
        AuthForm: expect.any(Function),
        CommandPalette: expect.any(Function),
        DashboardStat: expect.any(Function),
        SettingsPanel: expect.any(Function),
      });
      for (const name of names) expect(name in globalThis).toBe(false);
    } finally {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    }
  });
});
