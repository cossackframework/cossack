import type { OnBeforeSendHeadersListenerDetails } from 'electron';

export const desktopOrigin = 'cossack://app';
export const desktopOwnerHeader = 'x-cossack-desktop-owner';
export const desktopTokenHeader = 'x-cossack-desktop-token';

type RequestDetails = Pick<
  OnBeforeSendHeadersListenerDetails,
  'url' | 'method' | 'resourceType' | 'initiatorOrigin' | 'webContentsId' | 'requestHeaders'
>;

export function isDesktopAppUrl(url: URL): boolean {
  return (
    url.protocol === 'cossack:' &&
    url.hostname === 'app' &&
    url.username === '' &&
    url.password === '' &&
    url.port === ''
  );
}

/** Use native initiator evidence, never renderer-supplied Origin, Referer or query IDs. */
export function authorizeDesktopRequest(
  details: RequestDetails,
  owned: boolean,
  token: string,
): Record<string, string> | undefined {
  if (!owned || details.webContentsId === undefined) return;
  try {
    if (!isDesktopAppUrl(new URL(details.url))) return;
  } catch {
    return;
  }
  const browserNavigation =
    details.resourceType === 'mainFrame' &&
    details.method === 'GET' &&
    details.initiatorOrigin === undefined;
  if (!browserNavigation && details.initiatorOrigin !== desktopOrigin) return;
  const headers = new Headers(details.requestHeaders);
  const origin = headers.get('origin');
  if (origin !== null && origin !== desktopOrigin) return;
  headers.set(desktopOwnerHeader, String(details.webContentsId));
  headers.set(desktopTokenHeader, token);
  return Object.fromEntries(headers);
}
