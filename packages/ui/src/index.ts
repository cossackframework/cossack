/*
 * @cossackframework/ui — public barrel
 *
 * Components + Icon system. Import the CSS separately in your style.css:
 *
 *   @import "@cossackframework/ui/theme/base.css";
 *   @import "@cossackframework/ui/theme/theme.css";
 */

// Components
export { Button, type ButtonProps } from "./components/Button";
export { Input, type InputProps } from "./components/Input";
export {
    Card,
    CardHeader,
    CardBody,
    CardFooter,
    type CardProps,
} from "./components/Card";
export { Badge, type BadgeProps } from "./components/Badge";
export { Label, type LabelProps } from "./components/Label";
export { Alert, type AlertProps } from "./components/Alert";
export { Modal, type ModalProps } from "./components/Modal";
export {
    Accordion,
    AccordionItem,
    type AccordionItemProps,
} from "./components/Accordion";
export { Textarea, type TextareaProps } from "./components/Textarea";
export { Checkbox, type CheckboxProps } from "./components/Checkbox";
export { Switch, type SwitchProps } from "./components/Switch";
export { Select, type SelectProps } from "./components/Select";
export { Spinner, type SpinnerProps } from "./components/Spinner";

// Icons
export { Icon, type IconProps } from "./icons/Icon";
export { iconRegistry, iconNames } from "./icons/registry";
export { normalizeStyle, type IconStyle } from "./icons/types";
