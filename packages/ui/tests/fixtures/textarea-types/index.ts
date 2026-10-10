import { Textarea, Button, type TextareaProps, type ButtonProps } from '@cossackframework/ui';
import { component, live, ifDefined } from '@cossackframework/renderer';
const text: TextareaProps = {
    rows: 6, cols: 80, minlength: 2, maxlength: 1000, wrap: 'soft',
    '.value': live('message'), disabled: false, required: true,
    'aria-describedby': ifDefined(undefined),
    '@input': event => { const textarea: HTMLTextAreaElement = event.currentTarget; void textarea; },
};
component(Textarea, text);
component(Textarea, { rows: 6, cols: 80 });
const loadingCount: number = 1;
component(Button, { disabled: loadingCount > 0 });
// @ts-expect-error Numeric RPC counters require an explicit boolean comparison.
const badDisabled: ButtonProps = { disabled: loadingCount };
// @ts-expect-error Textarea rows are numeric dimensions, not boolean attributes.
const booleanRows: TextareaProps = { rows: true };
// @ts-expect-error Textarea columns require numbers.
const stringCols: TextareaProps = { cols: '80' };
// @ts-expect-error Textarea rows require numbers.
component(Textarea, { rows: '6' });
// @ts-expect-error Native listener names use renderer @event bindings.
component(Textarea, { onchange: () => {} });
// @ts-expect-error A textarea has no native value attribute; use .value.
component(Textarea, { value: 'message' });
void [badDisabled, booleanRows, stringCols];
