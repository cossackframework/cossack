import { CmsError } from '../errors';
import { FORM_BLOCKS, forms, formInputs, formSettings, notificationProblems } from '../form-builder';
import { beforeWrite } from '../hooks';
import type { CmsModule } from '../module';
import type { Block } from '../blocks';

export { forms, FORM_BLOCKS } from '../form-builder';

/**
 * The built-in forms module: the `forms` collection and its input blocks. A form's settings
 * and notifications are checked against its inputs when it is saved.
 */
export const formsModule: CmsModule = {
    owner: 'cms',
    resources: [],
    collections: [forms],
    blocks: FORM_BLOCKS,
    register({ hooks, blocks }) {
        hooks.addFilter(beforeWrite, (draft, { input }) => {
            if (input.resource !== 'cms/forms') return draft;
            const value = (name: string) => name in draft ? draft[name] : input.previous?.[name];
            const inputs = formInputs((value('body') ?? []) as Block[], blocks());
            const problems = notificationProblems(value('notifications'), inputs);
            const settings = formSettings(value('settings'));
            if (settings.confirmation === 'redirect' && !settings.redirectUrl) problems.push('Choose the page to go to after submitting.');
            if (settings.oncePerEmail && inputs.find(entry => entry.name === settings.oncePerEmail)?.kind !== 'email') problems.push(`One submission per address needs an email field; ${settings.oncePerEmail} is not one.`);
            if (settings.opensAt !== null && settings.closesAt !== null && settings.closesAt <= settings.opensAt) problems.push('The form must close after it opens.');
            if (problems.length) throw new CmsError('CMS_VALIDATION', problems.join(' '));
            return draft;
        }, { plugin: 'cms', priority: 20 });
    },
};
