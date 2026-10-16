// Native attribute types live in the renderer, which checks templates against
// the same map. They are re-exported here for components and the public API.
export type {
    ControlEvent, NativeEvents, AriaAttributes, GlobalAttributes, ButtonAttributes, AnchorAttributes,
    InputAttributes, CheckControlAttributes, LabelAttributes, FormAttributes, RangeAttributes,
    TextareaAttributes, SelectAttributes, PasswordAttributes, SvgAttributes, QuoteAttributes,
    OrderedListAttributes, TableCellAttributes, TableHeadAttributes,
} from '@cossackframework/renderer/attributes';

// Runtime helpers shared by components live in src/internal. Components import
// them through this module because `cossack add ui` rewrites this path to
// "@cossackframework/ui" when it ejects a component into an application.
export { ControlledValue } from './internal/controlled';
