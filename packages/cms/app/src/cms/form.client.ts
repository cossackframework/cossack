/**
 * The browser's part of a site form, loaded once a form is on the page. It applies the form's
 * conditions as values change, shows the checks the server will make as fields are left and
 * on sending, and sends the form in the background: the confirmation shows in place, or the
 * browser goes to the form's page. The form works the same without it.
 *
 * It writes only into elements the page renders empty (`data-cms-error`, `data-cms-form-error`,
 * `data-cms-form-done`) and toggles attributes, so the page's own rendering stays intact.
 */
import { formDataValues, formInputs, inputHtmlName, inputKey, TEMPLATE_ROW, validateSubmission, type Block, type BlockDeclaration, type InputKind } from '@cossackframework/cms';

const enhanced = new WeakSet<HTMLFormElement>();

export function enhanceForm(form: HTMLFormElement): void {
    if (enhanced.has(form)) return;
    enhanced.add(form);
    let blocks: Block[];
    let kinds: Record<string, InputKind>;
    try {
        blocks = JSON.parse(form.dataset.blocks ?? '[]') as Block[];
        kinds = JSON.parse(form.dataset.kinds ?? '{}') as Record<string, InputKind>;
    } catch { return; }
    const types = new Map<string, BlockDeclaration>(Object.entries(kinds).map(([name, kind]) => [name, { name, label: name, fields: {}, input: { kind } }]));
    const inputs = formInputs(blocks, types);
    const touched = new Set<string>();
    let sent = false;
    let busy = false;
    const formError = form.querySelector<HTMLElement>('[data-cms-form-error]');
    const done = form.querySelector<HTMLElement>('[data-cms-form-done]');
    const fields = form.querySelector<HTMLElement>('[data-cms-form-fields]');
    const submit = form.querySelector<HTMLButtonElement>('[data-cms-form-submit]');
    // A repeater's template row is not part of the form: its boxes and controls stay out of every check.
    const live = <T extends Element>(selector: string) => [...form.querySelectorAll<T>(selector)].filter(element => !element.closest('[data-cms-row-template]'));
    const controls = (key: string) => live<HTMLInputElement>('input, select, textarea').filter(control => control.name === inputHtmlName(key));
    /** The keys of every input on the page now, rows included, in page order. */
    const keys = () => live<HTMLElement>('[data-cms-error]').map(element => element.dataset.cmsError ?? '').filter(Boolean);

    const show = (errors: { readonly [name: string]: string }, server = false) => {
        for (const key of keys()) {
            const message = sent || server || touched.has(key) ? errors[key] ?? '' : '';
            const box = live<HTMLElement>('[data-cms-error]').find(element => element.dataset.cmsError === key);
            if (box) box.textContent = message;
            const fromServer = live<HTMLElement>('[data-cms-server-error]').some(element => element.dataset.cmsServerError === key && !element.hidden);
            for (const control of controls(key)) {
                if (message || fromServer) control.setAttribute('aria-invalid', 'true');
                else control.removeAttribute('aria-invalid');
            }
        }
    };
    const apply = () => {
        const check = validateSubmission(blocks, types, formDataValues(new FormData(form), inputs));
        for (const wrapper of live<HTMLElement>('[data-cms-when]')) wrapper.toggleAttribute('data-hidden', check.hidden.has(wrapper.dataset.cmsWhen ?? ''));
        show(check.errors);
        return check;
    };
    const focusFirst = (errors: { readonly [name: string]: string }) => {
        const first = keys().find(key => errors[key]);
        if (first) controls(first)[0]?.focus();
    };

    // The server's message about a field, from a post that came back, gives way once the field changes.
    const changed = (event: Event) => {
        const name = (event.target as HTMLInputElement | null)?.name;
        const key = name ? inputKey(name) : '';
        for (const element of live<HTMLElement>('[data-cms-server-error]')) if (key && element.dataset.cmsServerError === key) element.hidden = true;
        apply();
    };
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.addEventListener('focusout', event => {
        const name = (event.target as HTMLInputElement | null)?.name;
        if (name && !name.startsWith('_')) { touched.add(inputKey(name)); apply(); }
    });

    // Repeaters: Add copies the template row under a fresh id; Remove drops a row. Rows are numbered and the buttons follow the limits.
    const settle = (repeater: HTMLElement) => {
        const rows = [...repeater.querySelectorAll<HTMLElement>('[data-cms-rows] > [data-cms-row]')];
        const min = Number(repeater.dataset.min) || 0;
        const max = Number(repeater.dataset.max) || 50;
        rows.forEach((row, index) => {
            const number = row.querySelector<HTMLElement>('[data-cms-row-index]');
            if (number) number.textContent = String(index + 1);
            const remove = row.querySelector<HTMLButtonElement>('[data-cms-row-remove]');
            if (remove) remove.disabled = rows.length <= min;
        });
        const add = repeater.querySelector<HTMLButtonElement>('[data-cms-row-add]');
        if (add) add.disabled = rows.length >= max;
    };
    form.addEventListener('click', event => {
        const target = event.target as Element | null;
        const add = target?.closest<HTMLButtonElement>('[data-cms-row-add]');
        const remove = target?.closest<HTMLButtonElement>('[data-cms-row-remove]');
        if (!add && !remove) return;
        event.preventDefault();
        const repeater = (add ?? remove)!.closest<HTMLElement>('[data-cms-repeater]');
        if (!repeater) return;
        if (remove) {
            remove.closest('[data-cms-row]')?.remove();
        } else {
            const template = repeater.querySelector<HTMLElement>('[data-cms-row-template]');
            const list = repeater.querySelector<HTMLElement>('[data-cms-rows]');
            if (!template || !list || list.querySelectorAll(':scope > [data-cms-row]').length >= (Number(repeater.dataset.max) || 50)) return;
            const id = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            const holder = document.createElement('div');
            holder.innerHTML = template.outerHTML.replaceAll(TEMPLATE_ROW, id);
            const row = holder.firstElementChild as HTMLElement | null;
            if (!row) return;
            row.removeAttribute('hidden');
            row.removeAttribute('data-cms-row-template');
            for (const element of row.querySelectorAll('[disabled]')) element.removeAttribute('disabled');
            list.append(row);
            row.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea')?.focus();
        }
        settle(repeater);
        apply();
    });
    for (const repeater of form.querySelectorAll<HTMLElement>('[data-cms-repeater]')) settle(repeater);
    form.addEventListener('submit', event => {
        event.preventDefault();
        if (busy) return;
        sent = true;
        const check = apply();
        if (formError) formError.textContent = '';
        if (Object.keys(check.errors).length) { focusFirst(check.errors); return; }
        busy = true;
        if (submit) submit.disabled = true;
        void (async () => {
            try {
                const response = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { accept: 'application/json' }, credentials: 'same-origin' });
                const body = await response.json().catch(() => ({})) as { confirmation?: { kind: 'message'; html: string } | { kind: 'redirect'; url: string }; error?: string; fields?: Record<string, string> };
                if (response.ok && body.confirmation?.kind === 'redirect') { location.assign(body.confirmation.url); return; }
                if (response.ok && body.confirmation?.kind === 'message') {
                    if (done) { done.innerHTML = body.confirmation.html; done.hidden = false; done.focus?.(); }
                    if (fields) fields.hidden = true;
                    return;
                }
                if (body.fields && Object.keys(body.fields).length) { show(body.fields, true); focusFirst(body.fields); }
                if (formError) formError.textContent = body.error ?? 'The form could not be sent. Try again.';
            } catch {
                if (formError) formError.textContent = 'The form could not be sent. Check your connection and try again.';
            } finally {
                busy = false;
                if (submit) submit.disabled = false;
            }
        })();
    });
    apply();
}
