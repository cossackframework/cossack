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

// Icons
export { Icon, type IconProps } from "./icons/Icon";
export { iconRegistry, iconNames } from "./icons/registry";
export { normalizeStyle, type IconStyle } from "./icons/types";
