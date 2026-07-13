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
export { Avatar, type AvatarProps } from "./components/Avatar";
export { Separator, type SeparatorProps } from "./components/Separator";
export { Skeleton, type SkeletonProps } from "./components/Skeleton";
export { Progress, type ProgressProps } from "./components/Progress";
export { Tabs, type TabsProps } from "./components/Tabs";
export { Tooltip, type TooltipProps } from "./components/Tooltip";
export { Popover, type PopoverProps } from "./components/Popover";
export { RadioGroup, type RadioGroupProps } from "./components/RadioGroup";
export { Slider, type SliderProps } from "./components/Slider";
export {
    Table,
    TableHeader,
    TableBody,
    TableRow,
    TableHead,
    TableCell,
    type TableProps,
} from "./components/Table";
export { Toaster, toast, type ToastItem, type ToasterProps } from "./components/Toast";
export { DropdownMenu, type DropdownMenuProps } from "./components/DropdownMenu";
export { Sheet, type SheetProps } from "./components/Sheet";
export { Collapsible, type CollapsibleProps } from "./components/Collapsible";
export { Toggle, type ToggleProps } from "./components/Toggle";
export { ToggleGroup, type ToggleGroupProps } from "./components/ToggleGroup";
export { Breadcrumb, type BreadcrumbProps } from "./components/Breadcrumb";
export { Pagination, type PaginationProps } from "./components/Pagination";
export { AspectRatio, type AspectRatioProps } from "./components/AspectRatio";
export { Field, type FieldProps } from "./components/Field";
export { Empty, type EmptyProps } from "./components/Empty";
export { Kbd, type KbdProps } from "./components/Kbd";
export { ButtonGroup, type ButtonGroupProps } from "./components/ButtonGroup";
export { AlertDialog, type AlertDialogProps } from "./components/AlertDialog";
export { HoverCard, type HoverCardProps } from "./components/HoverCard";
export { ScrollArea, type ScrollAreaProps } from "./components/ScrollArea";
export { Resizable, type ResizableProps } from "./components/Resizable";
export { Carousel, type CarouselProps } from "./components/Carousel";
export { NavigationMenu, type NavigationMenuProps } from "./components/NavigationMenu";
export { Menubar, type MenubarProps } from "./components/Menubar";
export { Command, type CommandProps } from "./components/Command";
export { Combobox, type ComboboxProps } from "./components/Combobox";

// Icons
export { Icon, type IconProps } from "./icons/Icon";
export { iconRegistry, iconNames } from "./icons/registry";
export { normalizeStyle, type IconStyle } from "./icons/types";
