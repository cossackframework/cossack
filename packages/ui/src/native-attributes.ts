import type { BindResult, IfDefinedResult, LiveResult, PreventDefaultResult, nothing } from '@cossackframework/renderer';

/** Native listener event. currentTarget is the control; target can be a descendant. */
export type ControlEvent<Element extends HTMLElement, EventType extends Event = Event> = EventType & { readonly currentTarget: Element };
/** Renderer spread listeners use @event, not onEvent attributes. */
export type NativeEvents<Element extends HTMLElement> = {
    [Name in keyof HTMLElementEventMap as `@${Name}`]?:
        ((event: ControlEvent<Element, HTMLElementEventMap[Name]>) => unknown) | PreventDefaultResult | null | typeof nothing;
};
/** Attribute omission follows renderer semantics. Property bindings use their own contracts. */
type Attribute<Value> = Value | IfDefinedResult | null | typeof nothing;
type Attributes<Shape> = { [Key in keyof Shape]?: Attribute<Shape[Key]> } & {
    [Key in keyof Shape as NonNullable<Shape[Key]> extends boolean ? `?${Key & string}` : never]?: boolean | null | typeof nothing;
};
/** ARIA names come from the DOM library. Boolean/number values serialize as text. */
export type AriaAttributes = {
    [Name in keyof ARIAMixin as ARIAMixin[Name] extends string | null
        ? Name extends `aria${infer Suffix}` ? `aria-${Lowercase<Suffix>}` : never : never]?: Attribute<string | boolean | number>;
} & {
    // DOM reflection uses Element/Elements properties; HTML uses string ID references.
    [Name in keyof ARIAMixin as Name extends `aria${infer Suffix}Elements` ? `aria-${Lowercase<Suffix>}`
        : Name extends `aria${infer Suffix}Element` ? `aria-${Lowercase<Suffix>}` : never]?: Attribute<string>;
};
export type GlobalAttributes<Element extends HTMLElement = HTMLElement> = NativeEvents<Element> & AriaAttributes & Attributes<{
    id: string; class: string; style: string; title: string; role: string;
    lang: string; dir: 'ltr' | 'rtl' | 'auto'; tabindex: number;
    hidden: boolean | 'until-found'; inert: boolean; autofocus: boolean;
    slot: string; part: string; accesskey: string;
    draggable: boolean | 'true' | 'false'; spellcheck: boolean | 'true' | 'false';
    contenteditable: boolean | 'true' | 'false' | 'plaintext-only';
    translate: 'yes' | 'no';
}> & { [Name: `data-${string}`]: Attribute<string | number | boolean> | undefined };

type ValueBinding<Value> = Value | BindResult | LiveResult | null | typeof nothing;
export type ButtonAttributes = GlobalAttributes<HTMLButtonElement> & Attributes<{
    type: 'button' | 'submit' | 'reset'; disabled: boolean; name: string; value: string | number;
    form: string; formaction: string; formenctype: string; formmethod: 'get' | 'post' | 'dialog';
    formnovalidate: boolean; formtarget: string; popovertarget: string;
    popovertargetaction: 'hide' | 'show' | 'toggle';
}>;
/** Native links retain browser navigation, download and modifier-key behavior. */
export type AnchorAttributes = GlobalAttributes<HTMLAnchorElement> & Attributes<{
    href: string; target: string; rel: string; download: string | boolean;
    hreflang: string; type: string; referrerpolicy: ReferrerPolicy; ping: string;
}>;
export type InputAttributes = GlobalAttributes<HTMLInputElement> & Attributes<{
    type: 'button' | 'checkbox' | 'color' | 'date' | 'datetime-local' | 'email' | 'file' | 'hidden' |
        'image' | 'month' | 'number' | 'password' | 'radio' | 'range' | 'reset' | 'search' | 'submit' | 'tel' | 'text' | 'time' | 'url' | 'week';
    name: string; value: string | number; placeholder: string; disabled: boolean;
    readonly: boolean; required: boolean; multiple: boolean; checked: boolean;
    autocomplete: string; inputmode: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
    enterkeyhint: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
    min: string | number; max: string | number; step: number | 'any'; minlength: number; maxlength: number;
    pattern: string; accept: string; capture: 'user' | 'environment'; list: string;
    form: string; formaction: string; formenctype: string; formmethod: 'get' | 'post' | 'dialog';
    formnovalidate: boolean; formtarget: string; src: string; alt: string; width: number; height: number;
}> & {
    /** Use .value for reactive DOM values, including bind()/live(). */
    '.value'?: ValueBinding<string | number>;
    '.checked'?: ValueBinding<boolean>;
    '.indeterminate'?: ValueBinding<boolean>;
};
/** Checked state is owned by the component's checked prop, not a competing spread. */
export type CheckControlAttributes = Omit<GlobalAttributes<HTMLInputElement>, 'role' | 'aria-checked'> & Attributes<{
    name: string; value: string | number; disabled: boolean; required: boolean; form: string;
}> & { '.value'?: ValueBinding<string | number> };
export type LabelAttributes = GlobalAttributes<HTMLLabelElement> & Attributes<{ for: string }>;
export type FormAttributes = GlobalAttributes<HTMLFormElement> & Attributes<{
    action: string; method: 'get' | 'post' | 'dialog'; enctype: string; target: string;
    name: string; autocomplete: 'on' | 'off'; 'accept-charset': string;
    rel: string; novalidate: boolean;
}>;

/** Native range attributes; numeric state and disabled behavior belong to Slider. */
export type RangeAttributes = Omit<GlobalAttributes<HTMLInputElement>, 'role' | 'aria-valuemin' | 'aria-valuemax' | 'aria-valuenow'> & Attributes<{
    name: string; form: string; list: string;
}>;

/** Multiline text uses .value; HTML has no textarea value attribute. */
export type TextareaAttributes = GlobalAttributes<HTMLTextAreaElement> & Attributes<{
    name: string; form: string; placeholder: string; disabled: boolean; readonly: boolean; required: boolean;
    autocomplete: string; cols: number; minlength: number; maxlength: number; wrap: 'soft' | 'hard';
    dirname: string; inputmode: 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
    enterkeyhint: 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
}> & { '.value'?: ValueBinding<string> };
/** Selection uses .value or selected option children; HTML has no select value attribute. */
export type SelectAttributes = GlobalAttributes<HTMLSelectElement> & Attributes<{
    name: string; form: string; disabled: boolean; required: boolean; multiple: boolean; autocomplete: string;
}> & { '.value'?: ValueBinding<string> };

/** PasswordInput owns value, type and disabled state across its input and reveal button. */
export type PasswordAttributes = Pick<InputAttributes, keyof GlobalAttributes<HTMLInputElement> |
    'name' | 'form' | 'placeholder' | 'readonly' | '?readonly' | 'required' | '?required' |
    'autocomplete' | 'minlength' | 'maxlength' | 'pattern' | 'inputmode' | 'enterkeyhint'>;
