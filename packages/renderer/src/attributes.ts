/**
 * Native attribute types for templates and component props.
 *
 * Template diagnostics check every attribute binding of an `html` or `svg`
 * template against these maps, and UI components declare their native props
 * with the same types. Attribute names are the HTML names (`tabindex`,
 * `readonly`), lowercase for HTML and as written for SVG (`viewBox`).
 */
import type { BindResult, IfDefinedResult, LiveResult, PreventDefaultResult } from './directives';
import type { nothing } from './cossack-html';
import type { CossackElement } from './cossack-element';

/** Native listener event. currentTarget is the control; target can be a descendant. */
export type ControlEvent<Element extends HTMLElement | SVGElement, EventType extends Event = Event> = EventType & { readonly currentTarget: Element };
/** Renderer spread listeners use @event, not onEvent attributes. */
export type NativeEvents<Element extends HTMLElement | SVGElement> = {
    [Name in keyof HTMLElementEventMap as `@${Name}`]?:
        ((event: ControlEvent<Element, HTMLElementEventMap[Name]>) => unknown) | PreventDefaultResult | null | typeof nothing;
};
/** Attribute omission follows renderer semantics. Property bindings use their own contracts. */
export type Attribute<Value> = Value | IfDefinedResult | null | typeof nothing;
/** Attribute types for a shape of attribute values, with `?name` for boolean attributes. */
export type Attributes<Shape> = { [Key in keyof Shape]?: Attribute<Shape[Key]> } & {
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
type InputMode = 'none' | 'text' | 'decimal' | 'numeric' | 'tel' | 'search' | 'email' | 'url';
type EnterKeyHint = 'enter' | 'done' | 'go' | 'next' | 'previous' | 'search' | 'send';
type CrossOrigin = 'anonymous' | 'use-credentials' | '';
type FetchPriority = 'high' | 'low' | 'auto';
/** Attributes every HTML element accepts. */
export type GlobalAttributes<Element extends HTMLElement = HTMLElement> = NativeEvents<Element> & AriaAttributes & Attributes<{
    id: string; class: string; style: string; title: string; role: string;
    lang: string; dir: 'ltr' | 'rtl' | 'auto'; tabindex: number;
    hidden: boolean | 'until-found'; inert: boolean; autofocus: boolean;
    slot: string; part: string; exportparts: string; accesskey: string;
    draggable: boolean | 'true' | 'false'; spellcheck: boolean | 'true' | 'false';
    contenteditable: boolean | 'true' | 'false' | 'plaintext-only';
    translate: 'yes' | 'no';
    autocapitalize: 'off' | 'none' | 'on' | 'sentences' | 'words' | 'characters';
    autocorrect: 'on' | 'off'; writingsuggestions: boolean | 'true' | 'false';
    inputmode: InputMode; enterkeyhint: EnterKeyHint;
    popover: boolean | 'auto' | 'manual' | 'hint'; is: string; nonce: string;
    itemscope: boolean; itemtype: string; itemprop: string; itemid: string; itemref: string;
}> & { [Name: `data-${string}`]: Attribute<string | number | boolean> | undefined };

type ValueBinding<Value> = Value | BindResult | LiveResult | null | typeof nothing;
export type ButtonAttributes = GlobalAttributes<HTMLButtonElement> & Attributes<{
    type: 'button' | 'submit' | 'reset'; disabled: boolean; name: string; value: string | number;
    form: string; formaction: string; formenctype: string; formmethod: 'get' | 'post' | 'dialog';
    formnovalidate: boolean; formtarget: string; popovertarget: string;
    popovertargetaction: 'hide' | 'show' | 'toggle'; command: string; commandfor: string;
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
    autocomplete: string; inputmode: InputMode; enterkeyhint: EnterKeyHint;
    min: string | number; max: string | number; step: number | 'any'; minlength: number; maxlength: number;
    pattern: string; accept: string; capture: 'user' | 'environment'; list: string; dirname: string;
    form: string; formaction: string; formenctype: string; formmethod: 'get' | 'post' | 'dialog';
    formnovalidate: boolean; formtarget: string; src: string; alt: string; width: number; height: number;
    popovertarget: string; popovertargetaction: 'hide' | 'show' | 'toggle';
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
    autocomplete: string; cols: number; rows: number; minlength: number; maxlength: number; wrap: 'soft' | 'hard';
    dirname: string; inputmode: InputMode; enterkeyhint: EnterKeyHint;
}> & { '.value'?: ValueBinding<string> };
/** Selection uses .value or selected option children; HTML has no select value attribute. */
export type SelectAttributes = GlobalAttributes<HTMLSelectElement> & Attributes<{
    name: string; form: string; disabled: boolean; required: boolean; multiple: boolean; autocomplete: string;
}> & { '.value'?: ValueBinding<string> };

/** PasswordInput owns value, type and disabled state across its input and reveal button. */
export type PasswordAttributes = Pick<InputAttributes, keyof GlobalAttributes<HTMLInputElement> |
    'name' | 'form' | 'placeholder' | 'readonly' | '?readonly' | 'required' | '?required' |
    'autocomplete' | 'minlength' | 'maxlength' | 'pattern' | 'inputmode' | 'enterkeyhint'>;

/** Native SVG root attributes. HTML form and editable attributes do not apply. */
export type SvgAttributes = NativeEvents<SVGSVGElement> & AriaAttributes & Attributes<{
    id: string; class: string; style: string; role: string; lang: string;
    tabindex: number; focusable: 'true' | 'false';
    width: number | string; height: number | string; viewBox: string;
    fill: string; stroke: string; 'stroke-width': number | string;
}> & { [Name: `data-${string}`]: Attribute<string | number | boolean> | undefined };

export type QuoteAttributes = GlobalAttributes<HTMLQuoteElement> & Attributes<{ cite: string }>;
export type OrderedListAttributes = GlobalAttributes<HTMLOListElement> & Attributes<{
    start: number; reversed: boolean; type: '1' | 'a' | 'A' | 'i' | 'I';
}>;

/** Attributes shared by native data and header cells. */
export type TableCellAttributes = GlobalAttributes<HTMLTableCellElement> & Attributes<{
    colspan: number; rowspan: number; headers: string;
}>;
export type TableHeadAttributes = TableCellAttributes & Attributes<{
    scope: 'row' | 'col' | 'rowgroup' | 'colgroup'; abbr: string;
}>;

// --- Every other HTML element ---

// UI components use `size` for their visual size, so the numeric HTML size is
// only part of the element map.
type InputElementAttributes = InputAttributes & Attributes<{ size: number }>;
type SelectElementAttributes = SelectAttributes & Attributes<{ size: number }>;

type Media = Attributes<{
    src: string; crossorigin: CrossOrigin; preload: 'none' | 'metadata' | 'auto' | '';
    autoplay: boolean; loop: boolean; muted: boolean; controls: boolean; controlslist: string;
    disableremoteplayback: boolean;
}>;
export type AudioAttributes = GlobalAttributes<HTMLAudioElement> & Media;
export type VideoAttributes = GlobalAttributes<HTMLVideoElement> & Media & Attributes<{
    poster: string; playsinline: boolean; width: number; height: number; disablepictureinpicture: boolean;
}>;
export type AreaAttributes = GlobalAttributes<HTMLAreaElement> & Attributes<{
    alt: string; coords: string; shape: 'circle' | 'default' | 'poly' | 'rect'; href: string; target: string;
    download: string | boolean; ping: string; rel: string; referrerpolicy: ReferrerPolicy;
}>;
export type BaseAttributes = GlobalAttributes<HTMLBaseElement> & Attributes<{ href: string; target: string }>;
export type CanvasAttributes = GlobalAttributes<HTMLCanvasElement> & Attributes<{ width: number; height: number }>;
export type ColAttributes = GlobalAttributes<HTMLTableColElement> & Attributes<{ span: number }>;
export type DataAttributes = GlobalAttributes<HTMLDataElement> & Attributes<{ value: string | number }>;
export type ModAttributes = GlobalAttributes<HTMLModElement> & Attributes<{ cite: string; datetime: string }>;
export type DetailsAttributes = GlobalAttributes<HTMLDetailsElement> & Attributes<{ open: boolean; name: string }>;
export type DialogAttributes = GlobalAttributes<HTMLDialogElement> & Attributes<{ open: boolean; closedby: 'any' | 'closerequest' | 'none' }>;
export type EmbedAttributes = GlobalAttributes<HTMLEmbedElement> & Attributes<{ src: string; type: string; width: number | string; height: number | string }>;
export type FieldsetAttributes = GlobalAttributes<HTMLFieldSetElement> & Attributes<{ disabled: boolean; form: string; name: string }>;
export type HtmlAttributes = GlobalAttributes<HTMLHtmlElement> & Attributes<{ xmlns: string }>;
export type IframeAttributes = GlobalAttributes<HTMLIFrameElement> & Attributes<{
    src: string; srcdoc: string; name: string; sandbox: string; allow: string; allowfullscreen: boolean;
    width: number | string; height: number | string; referrerpolicy: ReferrerPolicy; loading: 'eager' | 'lazy';
}>;
export type ImageAttributes = GlobalAttributes<HTMLImageElement> & Attributes<{
    alt: string; src: string; srcset: string; sizes: string; crossorigin: CrossOrigin; usemap: string; ismap: boolean;
    width: number | string; height: number | string; referrerpolicy: ReferrerPolicy; decoding: 'sync' | 'async' | 'auto';
    loading: 'eager' | 'lazy'; fetchpriority: FetchPriority;
}>;
export type ListItemAttributes = GlobalAttributes<HTMLLIElement> & Attributes<{ value: number }>;
export type LinkAttributes = GlobalAttributes<HTMLLinkElement> & Attributes<{
    href: string; crossorigin: CrossOrigin; rel: string; as: string; media: string; hreflang: string; type: string;
    sizes: string; imagesrcset: string; imagesizes: string; referrerpolicy: ReferrerPolicy; integrity: string;
    blocking: string; color: string; disabled: boolean; fetchpriority: FetchPriority;
}>;
export type MapAttributes = GlobalAttributes<HTMLMapElement> & Attributes<{ name: string }>;
export type MetaAttributes = GlobalAttributes<HTMLMetaElement> & Attributes<{
    name: string; 'http-equiv': string; content: string; charset: string; media: string;
}>;
export type MeterAttributes = GlobalAttributes<HTMLMeterElement> & Attributes<{
    value: number; min: number; max: number; low: number; high: number; optimum: number;
}>;
export type ObjectAttributes = GlobalAttributes<HTMLObjectElement> & Attributes<{
    data: string; type: string; name: string; form: string; width: number | string; height: number | string;
}>;
export type OptgroupAttributes = GlobalAttributes<HTMLOptGroupElement> & Attributes<{ disabled: boolean; label: string }>;
export type OptionAttributes = GlobalAttributes<HTMLOptionElement> & Attributes<{
    disabled: boolean; label: string; selected: boolean; value: string | number;
}>;
export type OutputAttributes = GlobalAttributes<HTMLOutputElement> & Attributes<{ for: string; form: string; name: string }>;
export type ProgressAttributes = GlobalAttributes<HTMLProgressElement> & Attributes<{ value: number; max: number }>;
export type ScriptAttributes = GlobalAttributes<HTMLScriptElement> & Attributes<{
    src: string; type: string; nomodule: boolean; async: boolean; defer: boolean; crossorigin: CrossOrigin;
    integrity: string; referrerpolicy: ReferrerPolicy; blocking: string; fetchpriority: FetchPriority;
}>;
export type SlotAttributes = GlobalAttributes<HTMLSlotElement> & Attributes<{ name: string }>;
export type SourceAttributes = GlobalAttributes<HTMLSourceElement> & Attributes<{
    type: string; media: string; src: string; srcset: string; sizes: string; width: number; height: number;
}>;
export type StyleAttributes = GlobalAttributes<HTMLStyleElement> & Attributes<{ media: string; blocking: string }>;
export type TemplateElementAttributes = GlobalAttributes<HTMLTemplateElement> & Attributes<{
    shadowrootmode: 'open' | 'closed'; shadowrootdelegatesfocus: boolean; shadowrootclonable: boolean; shadowrootserializable: boolean;
}>;
export type TimeAttributes = GlobalAttributes<HTMLTimeElement> & Attributes<{ datetime: string }>;
export type TrackAttributes = GlobalAttributes<HTMLTrackElement> & Attributes<{
    default: boolean; kind: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata'; label: string; src: string; srclang: string;
}>;

/** The attributes each HTML element accepts, by lowercase tag name. */
export interface HTMLElementAttributeMap {
    a: AnchorAttributes; abbr: GlobalAttributes; address: GlobalAttributes; area: AreaAttributes;
    article: GlobalAttributes; aside: GlobalAttributes; audio: AudioAttributes;
    b: GlobalAttributes; base: BaseAttributes; bdi: GlobalAttributes; bdo: GlobalAttributes;
    blockquote: QuoteAttributes; body: GlobalAttributes<HTMLBodyElement>; br: GlobalAttributes<HTMLBRElement>;
    button: ButtonAttributes; canvas: CanvasAttributes; caption: GlobalAttributes<HTMLTableCaptionElement>;
    cite: GlobalAttributes; code: GlobalAttributes; col: ColAttributes; colgroup: ColAttributes;
    data: DataAttributes; datalist: GlobalAttributes<HTMLDataListElement>; dd: GlobalAttributes;
    del: ModAttributes; details: DetailsAttributes; dfn: GlobalAttributes; dialog: DialogAttributes;
    div: GlobalAttributes<HTMLDivElement>; dl: GlobalAttributes<HTMLDListElement>; dt: GlobalAttributes;
    em: GlobalAttributes; embed: EmbedAttributes; fieldset: FieldsetAttributes; figcaption: GlobalAttributes;
    figure: GlobalAttributes; footer: GlobalAttributes; form: FormAttributes;
    h1: GlobalAttributes<HTMLHeadingElement>; h2: GlobalAttributes<HTMLHeadingElement>; h3: GlobalAttributes<HTMLHeadingElement>;
    h4: GlobalAttributes<HTMLHeadingElement>; h5: GlobalAttributes<HTMLHeadingElement>; h6: GlobalAttributes<HTMLHeadingElement>;
    head: GlobalAttributes<HTMLHeadElement>; header: GlobalAttributes; hgroup: GlobalAttributes;
    hr: GlobalAttributes<HTMLHRElement>; html: HtmlAttributes; i: GlobalAttributes; iframe: IframeAttributes;
    img: ImageAttributes; input: InputElementAttributes; ins: ModAttributes; kbd: GlobalAttributes;
    label: LabelAttributes; legend: GlobalAttributes<HTMLLegendElement>; li: ListItemAttributes;
    link: LinkAttributes; main: GlobalAttributes; map: MapAttributes; mark: GlobalAttributes;
    menu: GlobalAttributes<HTMLMenuElement>; meta: MetaAttributes; meter: MeterAttributes; nav: GlobalAttributes;
    noscript: GlobalAttributes; object: ObjectAttributes; ol: OrderedListAttributes; optgroup: OptgroupAttributes;
    option: OptionAttributes; output: OutputAttributes; p: GlobalAttributes<HTMLParagraphElement>;
    picture: GlobalAttributes<HTMLPictureElement>; pre: GlobalAttributes<HTMLPreElement>; progress: ProgressAttributes;
    q: QuoteAttributes; rp: GlobalAttributes; rt: GlobalAttributes; ruby: GlobalAttributes; s: GlobalAttributes;
    samp: GlobalAttributes; script: ScriptAttributes; search: GlobalAttributes; section: GlobalAttributes;
    select: SelectElementAttributes; slot: SlotAttributes; small: GlobalAttributes; source: SourceAttributes;
    span: GlobalAttributes<HTMLSpanElement>; strong: GlobalAttributes; style: StyleAttributes; sub: GlobalAttributes;
    summary: GlobalAttributes; sup: GlobalAttributes; table: GlobalAttributes<HTMLTableElement>;
    tbody: GlobalAttributes<HTMLTableSectionElement>; td: TableCellAttributes; template: TemplateElementAttributes;
    textarea: TextareaAttributes; tfoot: GlobalAttributes<HTMLTableSectionElement>; th: TableHeadAttributes;
    thead: GlobalAttributes<HTMLTableSectionElement>; time: TimeAttributes; title: GlobalAttributes<HTMLTitleElement>;
    tr: GlobalAttributes<HTMLTableRowElement>; track: TrackAttributes; u: GlobalAttributes; ul: GlobalAttributes<HTMLUListElement>;
    var: GlobalAttributes; video: VideoAttributes; wbr: GlobalAttributes;
}

// --- SVG ---

type SvgValue = string | number;
/**
 * Attributes of SVG elements: core, presentation, geometry, paint server,
 * filter and animation attributes. One shape covers every SVG element.
 */
export type SVGElementAttributes<Element extends SVGElement = SVGElement> = NativeEvents<Element> & AriaAttributes & Attributes<{
    id: string; class: string; style: string; lang: string; 'xml:lang': string; 'xml:space': string; tabindex: number;
    role: string; autofocus: boolean; nonce: string; focusable: 'true' | 'false'; xmlns: string; 'xmlns:xlink': string;
    version: string; requiredExtensions: string; systemLanguage: string;
    // Presentation
    'alignment-baseline': string; 'baseline-shift': SvgValue; clip: string; 'clip-path': string; 'clip-rule': 'nonzero' | 'evenodd' | 'inherit';
    color: string; 'color-interpolation': string; 'color-interpolation-filters': string; cursor: string; direction: string;
    display: string; 'dominant-baseline': string; fill: string; 'fill-opacity': SvgValue; 'fill-rule': 'nonzero' | 'evenodd' | 'inherit';
    filter: string; 'flood-color': string; 'flood-opacity': SvgValue; font: string; 'font-family': string; 'font-size': SvgValue;
    'font-size-adjust': SvgValue; 'font-stretch': string; 'font-style': string; 'font-variant': string; 'font-weight': SvgValue;
    'image-rendering': string; 'letter-spacing': SvgValue; 'lighting-color': string; marker: string; 'marker-end': string;
    'marker-mid': string; 'marker-start': string; mask: string; 'mask-type': string; opacity: SvgValue; overflow: string;
    'paint-order': string; 'pointer-events': string; 'shape-rendering': string; 'stop-color': string; 'stop-opacity': SvgValue;
    stroke: string; 'stroke-dasharray': SvgValue; 'stroke-dashoffset': SvgValue; 'stroke-linecap': 'butt' | 'round' | 'square' | 'inherit';
    'stroke-linejoin': 'arcs' | 'bevel' | 'miter' | 'miter-clip' | 'round' | 'inherit'; 'stroke-miterlimit': SvgValue;
    'stroke-opacity': SvgValue; 'stroke-width': SvgValue; 'text-anchor': 'start' | 'middle' | 'end' | 'inherit';
    'text-decoration': string; 'text-overflow': string; 'text-rendering': string; transform: string; 'transform-box': string;
    'transform-origin': string; 'unicode-bidi': string; 'vector-effect': string; visibility: string; 'white-space': string;
    'word-spacing': SvgValue; 'writing-mode': string; 'mix-blend-mode': string; isolation: string;
    // Geometry and structure
    x: SvgValue; y: SvgValue; width: SvgValue; height: SvgValue; cx: SvgValue; cy: SvgValue; r: SvgValue; rx: SvgValue; ry: SvgValue;
    x1: SvgValue; y1: SvgValue; x2: SvgValue; y2: SvgValue; d: string; points: string; pathLength: SvgValue;
    viewBox: string; preserveAspectRatio: string; href: string; 'xlink:href': string; 'xlink:title': string;
    dx: SvgValue; dy: SvgValue; rotate: SvgValue; textLength: SvgValue; lengthAdjust: 'spacing' | 'spacingAndGlyphs';
    startOffset: SvgValue; method: 'align' | 'stretch'; spacing: 'auto' | 'exact'; side: 'left' | 'right'; path: string;
    // Paint servers, markers, masks and clipping
    gradientUnits: 'userSpaceOnUse' | 'objectBoundingBox'; gradientTransform: string; spreadMethod: 'pad' | 'reflect' | 'repeat';
    fx: SvgValue; fy: SvgValue; fr: SvgValue; offset: SvgValue; patternUnits: 'userSpaceOnUse' | 'objectBoundingBox';
    patternContentUnits: 'userSpaceOnUse' | 'objectBoundingBox'; patternTransform: string; markerWidth: SvgValue;
    markerHeight: SvgValue; markerUnits: 'strokeWidth' | 'userSpaceOnUse'; refX: SvgValue; refY: SvgValue; orient: SvgValue;
    maskUnits: 'userSpaceOnUse' | 'objectBoundingBox'; maskContentUnits: 'userSpaceOnUse' | 'objectBoundingBox';
    clipPathUnits: 'userSpaceOnUse' | 'objectBoundingBox';
    // Filters
    filterUnits: 'userSpaceOnUse' | 'objectBoundingBox'; primitiveUnits: 'userSpaceOnUse' | 'objectBoundingBox';
    in: string; in2: string; result: string; stdDeviation: SvgValue; mode: string; operator: string; values: string;
    type: string; k: SvgValue; k1: SvgValue; k2: SvgValue; k3: SvgValue; k4: SvgValue; kernelMatrix: string; order: SvgValue;
    divisor: SvgValue; bias: SvgValue; targetX: SvgValue; targetY: SvgValue; edgeMode: string; preserveAlpha: 'true' | 'false';
    surfaceScale: SvgValue; diffuseConstant: SvgValue; specularConstant: SvgValue; specularExponent: SvgValue;
    kernelUnitLength: SvgValue; azimuth: SvgValue; elevation: SvgValue; pointsAtX: SvgValue; pointsAtY: SvgValue;
    pointsAtZ: SvgValue; limitingConeAngle: SvgValue; baseFrequency: SvgValue; numOctaves: SvgValue; seed: SvgValue;
    stitchTiles: 'stitch' | 'noStitch'; scale: SvgValue; xChannelSelector: 'R' | 'G' | 'B' | 'A';
    yChannelSelector: 'R' | 'G' | 'B' | 'A'; radius: SvgValue; tableValues: string; slope: SvgValue; intercept: SvgValue;
    amplitude: SvgValue; exponent: SvgValue;
    // Animation
    attributeName: string; attributeType: string; begin: string; dur: string; end: string; min: string; max: string;
    repeatCount: SvgValue; repeatDur: string; restart: 'always' | 'whenNotActive' | 'never'; from: SvgValue; to: SvgValue;
    by: SvgValue; additive: 'replace' | 'sum'; accumulate: 'none' | 'sum'; calcMode: 'discrete' | 'linear' | 'paced' | 'spline';
    keyTimes: string; keySplines: string; keyPoints: string;
    // Links and images
    target: string; download: string | boolean; hreflang: string; ping: string; rel: string; referrerpolicy: ReferrerPolicy;
    crossorigin: CrossOrigin; decoding: 'sync' | 'async' | 'auto'; media: string;
}> & { [Name: `data-${string}`]: Attribute<string | number | boolean> | undefined };

/** The attributes each SVG element accepts, by tag name as written. */
export type SVGElementAttributeMap = { [Tag in keyof SVGElementTagNameMap]: SVGElementAttributes<SVGElementTagNameMap[Tag]> };

/** A `ref=${...}` value: a ref object or a callback that receives the element. */
export type RefValue = { value?: unknown } | ((element: any) => unknown) | null | undefined | typeof nothing;

/**
 * The types template diagnostics check bindings against. Exported with
 * `html` so a program that uses templates already contains them.
 */
export interface TemplateTypeMap {
    html: HTMLElementAttributeMap;
    svg: SVGElementAttributeMap;
    /** Attributes of unknown and custom HTML elements. */
    global: GlobalAttributes;
    /** Attributes of unknown SVG elements. */
    svgGlobal: SVGElementAttributes;
    htmlElements: HTMLElementTagNameMap;
    svgElements: SVGElementTagNameMap;
    /** Values that remove an attribute or leave it to the renderer. */
    omitted: null | undefined | typeof nothing;
    ifDefined: IfDefinedResult;
    live: LiveResult;
    bind: BindResult;
    preventDefault: PreventDefaultResult;
    /** Values a `?name=${...}` binding takes. */
    boolean: boolean | null | undefined | typeof nothing;
    /** Values an `@event=${...}` binding takes for an event the maps do not name. */
    listener: ((event: any) => unknown) | PreventDefaultResult | null | undefined | typeof nothing;
    ref: RefValue;
    /** The instance type of a class a component tag may bind. */
    component: CossackElement;
}
