import { expect, it } from 'vitest';
import {
  authorizeDesktopRequest,
  desktopOwnerHeader,
  desktopTokenHeader,
} from '../src/request-security';

const request = {
  url: 'cossack://app/crpc?__cossack_window=999',
  method: 'POST',
  resourceType: 'xhr',
  initiatorOrigin: 'cossack://app',
  webContentsId: 42,
  requestHeaders: {},
};
it('uses native initiator and owner even when Origin is absent or private headers/query IDs are forged', () => {
  const headers = authorizeDesktopRequest(
    {
      ...request,
      requestHeaders: {
        'X-Cossack-Desktop-Owner': '999',
        'X-Cossack-Desktop-Token': 'forged',
      },
    },
    true,
    'private-token',
  );
  expect(headers?.[desktopOwnerHeader]).toBe('42');
  expect(headers?.[desktopTokenHeader]).toBe('private-token');
});
it.each([undefined, 'null', 'https://foreign.example', 'cossack://other'])(
  'rejects an unverified native initiator (%s), even with forged trusted headers',
  (initiatorOrigin) => {
    expect(
      authorizeDesktopRequest(
        {
          ...request,
          initiatorOrigin,
          requestHeaders: { Origin: 'cossack://app', Referer: 'cossack://app/' },
        },
        true,
        'token',
      ),
    ).toBeUndefined();
  },
);
it('only allows browser-started GET main-frame navigation without an initiator', () => {
  const navigation = {
    ...request,
    method: 'GET',
    resourceType: 'mainFrame',
    initiatorOrigin: undefined,
  };
  expect(authorizeDesktopRequest(navigation, true, 'token')).toBeDefined();
  expect(authorizeDesktopRequest({ ...navigation, method: 'POST' }, true, 'token')).toBeUndefined();
  expect(
    authorizeDesktopRequest({ ...navigation, resourceType: 'subFrame' }, true, 'token'),
  ).toBeUndefined();
  expect(
    authorizeDesktopRequest(
      { ...navigation, initiatorOrigin: 'https://foreign.example' },
      true,
      'token',
    ),
  ).toBeUndefined();
});
it('rejects unowned requests, foreign authority and conflicting Origin headers', () => {
  expect(authorizeDesktopRequest(request, false, 'token')).toBeUndefined();
  expect(
    authorizeDesktopRequest({ ...request, webContentsId: undefined }, true, 'token'),
  ).toBeUndefined();
  expect(
    authorizeDesktopRequest({ ...request, url: 'cossack://other/crpc' }, true, 'token'),
  ).toBeUndefined();
  expect(
    authorizeDesktopRequest({ ...request, requestHeaders: { Origin: 'null' } }, true, 'token'),
  ).toBeUndefined();
});
