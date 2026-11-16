import { Cossack, Page } from '@cossackframework/core';

/** "New" opens the library with its uploader. */
@Page({ transport: 'http' })
export default class AddMedia extends Cossack {
    async get() {
        return this.c.redirect('/dashboard/media?upload=1');
    }
}
