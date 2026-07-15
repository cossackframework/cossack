import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export interface FormProps {
    /**
     * Submit handler — typically a `@Server()` method. When provided, the form's
     * submit default is prevented (no page reload) and `novalidate` is added by
     * default, so you can use `@Validate`/custom validation instead of the
     * browser's native HTML5 checks. The handler reads field values from bound
     * `@State`/`@Store` (use `bind()`), exactly like the bare
     * `<form @submit="${preventDefault(this.handleSubmit)}">` pattern.
     *
     * Omit `submit` for a native `<form method="post">` submission read with
     * `getFormData()` in a page `post()` handler.
     */
    submit?: (event: SubmitEvent) => unknown;
    /**
     * Whether to add the native `novalidate` attribute. Defaults to `true` when
     * `submit` is set (RPC path uses custom validation); `false` otherwise (so
     * native-POST forms keep HTML5 validation unless you opt out).
     */
    novalidate?: boolean;
    /** Pass-through HTML attributes (method, action, class, ...). */
    [key: string]: any;
}

/**
 * Cossack UI Form — thin `<form>` wrapper.
 *
 * Removes the `@submit="${preventDefault(...)}"` + `novalidate` boilerplate for
 * the RPC (`@Server`) form pattern. Field values are still managed with
 * `bind()`/`@State`/`@Store` and validation with `@Validate`/`hasError`/
 * `getError` — this component only wraps the `<form>` element itself.
 *
 *   // RPC (@Server) pattern — submit prevented, novalidate added:
 *   component(Form, { submit: this.handleSubmit },
 *       html`<input .value="${bind(this, 'email')}" /> ${component(Button, { type: 'submit' }, 'Save')}`)
 *
 *   // Native POST pattern — default submit proceeds, read via getFormData():
 *   component(Form, { method: 'post' }, html`<input name="email" /> ...`)
 */
@Component()
export class Form extends Cossack {
    declare props: FormProps;

    render() {
        const { submit, novalidate, ...rest } = this.props;

        // Default novalidate: true only for the RPC path (custom validation);
        // false for native POST so HTML5 checks are kept unless opted out.
        const wantsNovalidate = novalidate ?? submit !== undefined;

        // When a submit handler is provided, wrap it to prevent the native
        // submit (page reload) before delegating. Routed through the `@submit`
        // key in `rest` so the renderer's SpreadPart binds it as an event
        // listener — same convention other components use for `@click`, etc.
        if (submit) {
            rest["@submit"] = (e: SubmitEvent) => {
                e.preventDefault();
                submit(e);
            };
        }
        if (wantsNovalidate) {
            // Presence attribute — SpreadPart sets it from a boolean true.
            rest["novalidate"] = true;
        }

        return html`
            <form ...=${rest}>
                ${this.children}
            </form>
        `;
    }
}
