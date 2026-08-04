import { createDenoAdapter } from '@cossackframework/deno-adapter';
import {
  createDesktopShell,
  type DesktopMenuEvent,
  type DesktopMenuItem,
  type DesktopTray,
} from '@cossackframework/deno-adapter/desktop';
import { createApp } from '@cossackframework/framework/router';
import { fileURLToPath } from 'node:url';
import { App } from '../App';
import { template } from '../root';

export const env: Record<string, unknown> = Deno.env.toObject();
const assetsRoot = fileURLToPath(new URL('../client/', Deno.mainModule));
export const runtime = createDenoAdapter({ env, assetsRoot });
export const app = createApp({ AppComponent: App, htmlTemplate: template, runtimeAdapter: runtime });

const shell = createDesktopShell();

if (shell.available && shell.window) {
  const window = shell.window;
  window.setTitle('Cossack Counter');
  let tray: DesktopTray | undefined;
  let quitting = false;

  const showWindow = () => {
    window.show();
    window.focus();
  };
  const hideWindow = () => window.hide();
  const invokeCounterAction = (action: 'increment' | 'decrement') => {
    void window.executeJs(`(() => {
      const button = document.querySelector('[data-counter-action="${action}"]');
      if (!(button instanceof HTMLElement)) return false;
      button.click();
      return true;
    })()`).then((invoked) => {
      if (invoked === false) {
        shell.dialogs.alert('The counter is still loading. Please try again.');
      }
    }).catch((error) => {
      console.warn(`Cossack Counter: could not ${action} from the native menu.`, error);
    });
  };
  const notify = async () => {
    const permission = shell.notifications.permission === 'granted'
      ? 'granted'
      : await shell.notifications.requestPermission();
    if (permission !== 'granted') {
      shell.dialogs.alert('Notifications were not allowed. You can enable them in system settings.');
      return;
    }
    const notification = shell.notifications.show('Cossack Counter', {
      body: 'Native notifications are working.',
      tag: 'cossack-counter-menu',
    });
    notification.addEventListener('click', showWindow);
  };
  const quit = () => {
    quitting = true;
    tray?.destroy();
    Deno.exit(0);
  };
  const handleAction = (id: string) => {
    switch (id) {
      case 'about':
        shell.dialogs.alert('Cossack Counter\nA Deno Desktop native-capability showcase.');
        break;
      case 'increment': invokeCounterAction('increment'); break;
      case 'decrement': invokeCounterAction('decrement'); break;
      case 'show': showWindow(); break;
      case 'hide': hideWindow(); break;
      case 'notify': void notify(); break;
      case 'quit': quit(); break;
    }
  };
  const onMenuClick = (event: DesktopMenuEvent) => handleAction(event.detail.id);
  const counterActions: DesktopMenuItem[] = [
    { item: { label: 'Increment count', id: 'increment', enabled: true } },
    { item: { label: 'Decrement count', id: 'decrement', enabled: true } },
  ];
  const actions: DesktopMenuItem[] = [
    { item: { label: 'About Cossack Counter', id: 'about', enabled: true } },
    'separator',
    { item: { label: 'Show window', id: 'show', enabled: true } },
    { item: { label: 'Hide window', id: 'hide', enabled: true } },
    { item: { label: 'Send notification', id: 'notify', enabled: true } },
    'separator',
    { item: { label: 'Quit', id: 'quit', accelerator: 'CmdOrCtrl+Q', enabled: true } },
  ];

  window.setApplicationMenu([{ submenu: { label: 'Cossack Counter', items: actions } }]);
  window.addEventListener('menuclick', onMenuClick);
  window.addEventListener('contextmenuclick', onMenuClick);

  tray = shell.createTray();
  if (tray.trayId !== 0) {
    const [trayIcon, trayDarkIcon] = await Promise.all([
      Deno.readFile(new URL('../../icons/tray.png', import.meta.url)),
      Deno.readFile(new URL('../../icons/tray-dark.png', import.meta.url)),
    ]);
    tray.setIcon(trayIcon);
    tray.setIconDark(trayDarkIcon);
    tray.setTooltip('Cossack Counter');
    tray.setMenu([
      ...counterActions,
      'separator',
      { item: { label: 'Show window', id: 'show', enabled: true } },
      { item: { label: 'Hide window', id: 'hide', enabled: true } },
      { item: { label: 'Send notification', id: 'notify', enabled: true } },
      'separator',
      { item: { label: 'Quit', id: 'quit', enabled: true } },
    ]);
    tray.addEventListener('click', showWindow);
    tray.addEventListener('menuclick', onMenuClick);
  } else {
    console.warn(
      'Cossack Counter: the active Desktop backend could not create a tray. Close-to-tray is disabled; on Linux, check both the Deno backend build and AppIndicator/KStatusNotifierItem support.',
    );
  }

  shell.dock.setMenu([
    { item: { label: 'Show Cossack Counter', id: 'show', enabled: true } },
    { item: { label: 'Send notification', id: 'notify', enabled: true } },
    'separator',
    { item: { label: 'Quit', id: 'quit', enabled: true } },
  ]);
  shell.dock.addEventListener('menuclick', onMenuClick);
  shell.dock.addEventListener('reopen', showWindow);
  window.addEventListener('close', (event: Event) => {
    if (!quitting && tray?.trayId !== 0) {
      event.preventDefault();
      hideWindow();
    }
  });
}

export default {
  fetch: (request: Request, requestEnv?: Record<string, unknown>) =>
    runtime.fetch(app, request, requestEnv),
};

if (import.meta.main && typeof (Deno as any).BrowserWindow !== 'function') {
  runtime.serve(app);
}
