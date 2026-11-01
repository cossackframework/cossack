import { Page } from '@cossackframework/core';
import SitePath, { resolveSitePath } from './[...path]/index';

/**
 * The home page: Settings → Reading's front page, or the latest posts. It is the page of every
 * other site path (`[...path]`, which resolves `/` as the home page) under its own route, so a
 * static front page is edited in place at `/?edit` like any other page. With the examples
 * feature, the examples home page takes `/` and this file is not rendered.
 */
@Page({ transport: 'http', middlewares: [resolveSitePath] })
export default class HomePage extends SitePath {}
