/**
 * The browser's part of a site form, loaded once a form is on the page. It applies the form's
 * conditions as values change, shows the checks the server will make as fields are left and
 * on sending, and sends the form in the background: the confirmation shows in place, or the
 * browser goes to the form's page. The form works the same without it.
 *
 * It writes only into elements the page renders empty (`data-cms-error`, `data-cms-form-error`,
 * `data-cms-form-done`) and toggles attributes, so the page's own rendering stays intact.
 */
import { formDataValues, formInputs, validateSubmission, type Block, type BlockDeclaration, type InputKind } from '@cossackframework/cms';

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
    const controls = (name: string) => [...form.querySelectorAll<HTMLInputElement>('input, select, textarea')].filter(control => control.name === name);

    const show = (errors: { readonly [name: string]: string }, server = false) => {
        for (const input of inputs) {
            const message = sent || server || touched.has(input.name) ? errors[input.name] ?? '' : '';
            const box = [...form.querySelectorAll<HTMLElement>('[data-cms-error]')].find(element => element.dataset.cmsError === input.name);
            if (box) box.textContent = message;
            const fromServer = [...form.querySelectorAll<HTMLElement>('[data-cms-server-error]')].some(element => element.dataset.cmsServerError === input.name && !element.hidden);
            for (const control of controls(input.name)) {
                if (message || fromServer) control.setAttribute('aria-invalid', 'true');
                else control.removeAttribute('aria-invalid');
            }
        }
    };
    const apply = () => {
        const check = validateSubmission(blocks, types, formDataValues(new FormData(form), inputs));
        for (const wrapper of form.querySelectorAll<HTMLElement>('[data-cms-when]')) wrapper.toggleAttribute('data-hidden', check.hidden.has(wrapper.dataset.cmsWhen ?? ''));
        show(check.errors);
        return check;
    };
    const focusFirst = (errors: { readonly [name: string]: string }) => {
        const first = inputs.find(input => errors[input.name]);
        if (first) controls(first.name)[0]?.focus();
    };

    // The server's message about a field, from a post that came back, gives way once the field changes.
    const changed = (event: Event) => {
        const name = (event.target as HTMLInputElement | null)?.name;
        for (const element of form.querySelectorAll<HTMLElement>('[data-cms-server-error]')) if (name && element.dataset.cmsServerError === name) element.hidden = true;
        apply();
    };
    form.addEventListener('input', changed);
    form.addEventListener('change', changed);
    form.addEventListener('focusout', event => {
        const name = (event.target as HTMLInputElement | null)?.name;
        if (name && !name.startsWith('_')) { touched.add(name); apply(); }
    });
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
