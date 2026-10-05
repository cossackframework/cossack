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
    type CardHeaderProps,
    type CardBodyProps,
    type CardFooterProps,
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
export { AvatarGroup, type AvatarGroupProps, type AvatarGroupItem } from "./components/AvatarGroup";
export { Separator, type SeparatorProps } from "./components/Separator";
export { Skeleton, type SkeletonProps, type SkeletonDimension } from "./components/Skeleton";
export { Progress, type ProgressProps } from "./components/Progress";
export { Tabs, type TabsProps, type TabsItem, type TabsListProps } from "./components/Tabs";
export { Tooltip, type TooltipProps } from "./components/Tooltip";
export { Popover, type PopoverProps, type PopoverContentProps } from "./components/Popover";
export { RadioGroup, type RadioGroupProps, type RadioGroupItem } from "./components/RadioGroup";
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
export { Toaster, toast, toastStore, createToastStore, type ToastItem, type ToastOptions, type ToastVariant, type ToastStore, type ToastStoreOptions, type ToasterProps } from "./components/Toast";
export { DropdownMenu, type DropdownMenuProps } from "./components/DropdownMenu";
export { Sheet, type SheetProps } from "./components/Sheet";
export { Collapsible, type CollapsibleProps } from "./components/Collapsible";
export { Toggle, type ToggleProps } from "./components/Toggle";
export { ToggleGroup, type ToggleGroupProps, type ToggleGroupItem } from "./components/ToggleGroup";
export { Breadcrumb, type BreadcrumbProps, type BreadcrumbItem, type BreadcrumbLinkProps, type BreadcrumbTextProps, type BreadcrumbListProps } from "./components/Breadcrumb";
export { Pagination, type PaginationProps, type PaginationButtonProps, type PaginationLinkProps } from "./components/Pagination";
export { AspectRatio, type AspectRatioProps } from "./components/AspectRatio";
export { Field, type FieldProps, type FieldControlAttributes } from "./components/Field";
export { Form, type FormProps } from "./components/Form";
export { Empty, type EmptyProps } from "./components/Empty";
export { Kbd, type KbdProps } from "./components/Kbd";
export { ButtonGroup, type ButtonGroupProps } from "./components/ButtonGroup";
export { AlertDialog, type AlertDialogProps } from "./components/AlertDialog";
export { HoverCard, type HoverCardProps } from "./components/HoverCard";
export { ScrollArea, type ScrollAreaProps } from "./components/ScrollArea";
export { Resizable, type ResizableProps, type ResizablePanelProps, type ResizableHandleProps } from "./components/Resizable";
export { Carousel, type CarouselProps, type CarouselSlide, type CarouselSlideProps, type CarouselViewportProps } from "./components/Carousel";
export { NavigationMenu, type NavigationMenuProps, type NavigationMenuSection, type NavigationMenuLink, type NavigationMenuLinkProps, type NavigationMenuTriggerProps, type NavigationMenuPanelProps } from "./components/NavigationMenu";
export { Menubar, type MenubarProps, type MenubarMenu, type MenubarTriggerProps } from "./components/Menubar";
export { Command, type CommandProps, type CommandItem } from "./components/Command";
export { Combobox, type ComboboxProps, type ComboboxOption } from "./components/Combobox";
export { Calendar, type CalendarProps } from "./components/Calendar";
export { DatePicker, type DatePickerProps } from "./components/DatePicker";
export { ContextMenu, type ContextMenuProps } from "./components/ContextMenu";
export { InputOTP, type InputOTPProps } from "./components/InputOTP";
export { Typography, type TypographyProps } from "./components/Typography";
export { Drawer, type DrawerProps } from "./components/Drawer";
export { Sidebar, type SidebarProps, type SidebarItem, type SidebarLinkItem, type SidebarGroupItem, type SidebarLinkProps, type SidebarNavProps } from "./components/Sidebar";
export { NativeSelect, type NativeSelectProps } from "./components/NativeSelect";
export { InputGroup, type InputGroupProps } from "./components/InputGroup";
export { Item, type ItemProps } from "./components/Item";
export { Bubble, type BubbleProps, type BubbleReaction } from "./components/Bubble";
export { Message, type MessageProps } from "./components/Message";
export { MessageScroller, type MessageScrollerProps, type MessageScrollerViewportProps, type MessageScrollerJumpProps } from "./components/MessageScroller";
export { Marker, type MarkerProps } from "./components/Marker";
export { Attachment, type AttachmentProps, type AttachmentType, type AttachmentStatusVariant, type AttachmentRemoveProps, type AttachmentThumbnailProps } from "./components/Attachment";
export { PasswordInput, type PasswordInputProps } from "./components/PasswordInput";
export { MultiSelect, type MultiSelectProps } from "./components/MultiSelect";

// Icons — components live here; data/types come from @cossackframework/solar-icons.
// Use `Icon` with a direct `entry` import (tree-shakeable). There is no
// name-based/icon-registry component: it pulled the full ~1,200-icon registry
// (~9MB of SVG paths) into the client bundle. Import the icon you need by name
// and pass it to <Icon>:  component(Icon, { entry: ArrowRightIcon })
export { Icon, normalizeStyle, type IconProps } from "./icons/Icon";
export type { IconStyle, IconEntry, IconRegistry } from "@cossackframework/solar-icons/types";

export { DataTable, type DataTableProps, type DataTableColumn, type DataTableState, type DataTableSort } from './components/DataTable';

export type { TableCellAttributes, TableHeadAttributes, ControlEvent, NativeEvents, AriaAttributes, QuoteAttributes, OrderedListAttributes, SvgAttributes, GlobalAttributes, ButtonAttributes, AnchorAttributes, InputAttributes, TextareaAttributes, SelectAttributes, PasswordAttributes, RangeAttributes, CheckControlAttributes, LabelAttributes, FormAttributes } from "./native-attributes";

export { isCalendarDate } from './internal/date';

export type { DialogControlProps } from './internal/dialog';

export type { MenuItem, MenuPanelProps } from './internal/menu';

export type { DisclosureProps, DisclosureTriggerProps, DisclosurePanelProps } from './internal/disclosure';

export { createUiFormBindings, type UiFormBindings, type UiFormFieldBinding } from './form-bindings';
