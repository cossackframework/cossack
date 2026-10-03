import type { FormAttributes, ControlEvent } from "../native-attributes";
import { html } from "@cossackframework/renderer";
import { Cossack, Component } from "@cossackframework/core";

export type FormProps = Omit<FormAttributes, "novalidate" | "?novalidate"> & {
    /**
     * Submit handler — typically a `@Server()` method. When provided, the form's
     * submit default is prevented (no page reload) and `novalidate` is added by
     * default, so you can use server action schemas/custom validation instead of the
     * browser's native HTML5 checks. The handler reads field values from bound
     * `@State`/`@Store` (use `bind()`), exactly like the bare
     * `<form @submit="${preventDefault(this.handleSubmit)}">` pattern.
     *
     * Omit `submit` for a native `<form method="post">` submission read with
     * `getFormData()` in a page `post()` handler.
     */
    submit?: (event: ControlEvent<HTMLFormElement, SubmitEvent>) => unknown;
    /**
     * Whether to add the native `novalidate` attribute. Defaults to `true` when
     * `submit` is set (RPC path uses custom validation); `false` otherwise (so
     * native-POST forms keep HTML5 validation unless you opt out).
     */
    novalidate?: boolean;
}

/**
 * Cossack UI Form — thin `<form>` wrapper.
 *
 * Removes the `@submit="${preventDefault(...)}"` + `novalidate` boilerplate for
 * the RPC (`@Server`) form pattern. Field values are still managed with
 * `bind()`/`@State`/`@Store`; server action schemas own validation.
 * This component only wraps the `<form>` element itself.
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

    /**
     * Wrap a submit handler so the native form submission (page reload) is
     * prevented before the delegate runs. Extracted from `render()` so the
     * preventDefault contract is unit-testable without DOM/event plumbing.
     */
    private wrapSubmit(submit: (event: ControlEvent<HTMLFormElement, SubmitEvent>) => unknown) {
        return (event: ControlEvent<HTMLFormElement, SubmitEvent>) => {
            event.preventDefault();
            submit(event);
        };
    }

    render() {
        const { submit, novalidate, ...attributes } = this.props;
        const rest: FormAttributes = attributes;

        // Default novalidate: true only for the RPC path (custom validation);
        // false for native POST so HTML5 checks are kept unless opted out.
        const wantsNovalidate = novalidate ?? submit !== undefined;

        // When a submit handler is provided, wrap it to prevent the native
        // submit (page reload) before delegating. Routed through the `@submit`
        // key in `rest` so the renderer's SpreadPart binds it as an event
        // listener — same convention other components use for `@click`, etc.
        if (submit) {
            rest["@submit"] = this.wrapSubmit(submit);
        }
        if (wantsNovalidate) {
            // Presence attribute — both the SSR spread and the client SpreadPart
            // emit a boolean `true` as the bare attribute name (`novalidate`),
            // not `novalidate="true"`.
            rest["novalidate"] = true;
        }

        return html`
            <form ...=${rest}>
                ${this.children}
            </form>
        `;
    }
}
