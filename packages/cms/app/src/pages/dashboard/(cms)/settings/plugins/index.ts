import { Cossack, Page } from '@cossackframework/core';
import { PERMISSIONS } from '@cossackframework/cms';
import { requireAny } from '../../../../../cms/guards';
import { settingsSectionHref } from '../../../../../cms/settings-search';

/** Existing links open the corresponding section of the unified Settings page. */
@Page({ transport: 'http', middlewares: [requireAny(PERMISSIONS.manageSettings)] })
export default class SettingsRedirect extends Cossack {
    async get() { return this.c.redirect(settingsSectionHref(this.c.req.query('plugin') ? `plugin:${this.c.req.query('plugin')}` : 'plugins')); }
}
