import { Cossack, Page } from '@cossackframework/core';

/** Settings open on the General tab. */
@Page({ transport: 'http' })
export default class SettingsIndex extends Cossack {
    async get() {
        return this.c.redirect('/dashboard/settings/general');
    }
}
