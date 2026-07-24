// ---------------------------------------------------------------------------
// `cossack add ui` — UI component catalog + barrel
//
// All entries use `fromPackage()`, which reads the component source directly
// from the installed @cossackframework/ui package at eject time. This avoids
// duplicating ~600 lines of template strings and eliminates drift between the
// catalog and the package source.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromCli = createRequire(import.meta.url);

/**
 * Read a component's source directly from the installed
 * @cossackframework/ui package. Falls back to a stub if the file can't be
 * resolved (e.g. package not yet installed during `cossack add ui` before
 * `pnpm install`).
 */
function ejectFromPackage(className) {
  const resolvers = [
    createRequire(path.join(process.cwd(), 'package.json')),
    requireFromCli,
  ];
  for (const resolver of resolvers) {
    try {
      const themePath = resolver.resolve(
        '@cossackframework/ui/theme/base.css',
      );
      const pkgDir = path.resolve(path.dirname(themePath), '../..');
      const srcPath = path.join(pkgDir, 'src', 'components', `${className}.ts`);
      return fs.readFileSync(srcPath, 'utf8')
        .replace(
          /from ["']\.\.\/icons\/Icon["']/g,
          'from "@cossackframework/ui"',
        )
        .replace(
          /from ["']\.\/Avatar["']/g,
          'from "@cossackframework/ui"',
        );
    } catch {
      // Try the next resolution root.
    }
  }
  return `// Run \`pnpm install\` then re-run \`cossack add ui ${className.toLowerCase()}\`
// to eject the full source from @cossackframework/ui.
export {};\n`;
}

/** Wrapper so the catalog entry shape stays consistent: { className, template }. */
const fromPackage = (className) => () => ejectFromPackage(className);

/**
 * Catalog of ejectable UI components. Keys are the names accepted by
 * `cossack add ui <name>`.
 */
export const UI_COMPONENTS = {
  button: { className: 'Button', template: fromPackage('Button') },
  input: { className: 'Input', template: fromPackage('Input') },
  card: { className: 'Card', template: fromPackage('Card') },
  badge: { className: 'Badge', template: fromPackage('Badge') },
  label: { className: 'Label', template: fromPackage('Label') },
  alert: { className: 'Alert', template: fromPackage('Alert') },
  modal: { className: 'Modal', template: fromPackage('Modal') },
  accordion: { className: 'Accordion', template: fromPackage('Accordion') },
  textarea: { className: 'Textarea', template: fromPackage('Textarea') },
  checkbox: { className: 'Checkbox', template: fromPackage('Checkbox') },
  switch: { className: 'Switch', template: fromPackage('Switch') },
  select: { className: 'Select', template: fromPackage('Select') },
  spinner: { className: 'Spinner', template: fromPackage('Spinner') },
  avatar: { className: 'Avatar', template: fromPackage('Avatar') },
  'avatar-group': { className: 'AvatarGroup', template: fromPackage('AvatarGroup') },
  separator: { className: 'Separator', template: fromPackage('Separator') },
  skeleton: { className: 'Skeleton', template: fromPackage('Skeleton') },
  progress: { className: 'Progress', template: fromPackage('Progress') },
  tabs: { className: 'Tabs', template: fromPackage('Tabs') },
  tooltip: { className: 'Tooltip', template: fromPackage('Tooltip') },
  popover: { className: 'Popover', template: fromPackage('Popover') },
  'radio-group': { className: 'RadioGroup', template: fromPackage('RadioGroup') },
  slider: { className: 'Slider', template: fromPackage('Slider') },
  table: { className: 'Table', template: fromPackage('Table') },
  toaster: { className: 'Toaster', template: fromPackage('Toaster') },
  'dropdown-menu': { className: 'DropdownMenu', template: fromPackage('DropdownMenu') },
  sheet: { className: 'Sheet', template: fromPackage('Sheet') },
  collapsible: { className: 'Collapsible', template: fromPackage('Collapsible') },
  toggle: { className: 'Toggle', template: fromPackage('Toggle') },
  'toggle-group': { className: 'ToggleGroup', template: fromPackage('ToggleGroup') },
  breadcrumb: { className: 'Breadcrumb', template: fromPackage('Breadcrumb') },
  pagination: { className: 'Pagination', template: fromPackage('Pagination') },
  'aspect-ratio': { className: 'AspectRatio', template: fromPackage('AspectRatio') },
  field: { className: 'Field', template: fromPackage('Field') },
  form: { className: 'Form', template: fromPackage('Form') },
  empty: { className: 'Empty', template: fromPackage('Empty') },
  kbd: { className: 'Kbd', template: fromPackage('Kbd') },
  'button-group': { className: 'ButtonGroup', template: fromPackage('ButtonGroup') },
  'alert-dialog': { className: 'AlertDialog', template: fromPackage('AlertDialog') },
  'hover-card': { className: 'HoverCard', template: fromPackage('HoverCard') },
  'scroll-area': { className: 'ScrollArea', template: fromPackage('ScrollArea') },
  resizable: { className: 'Resizable', template: fromPackage('Resizable') },
  carousel: { className: 'Carousel', template: fromPackage('Carousel') },
  'navigation-menu': { className: 'NavigationMenu', template: fromPackage('NavigationMenu') },
  menubar: { className: 'Menubar', template: fromPackage('Menubar') },
  command: { className: 'Command', template: fromPackage('Command') },
  combobox: { className: 'Combobox', template: fromPackage('Combobox') },
  calendar: { className: 'Calendar', template: fromPackage('Calendar') },
  'date-picker': { className: 'DatePicker', template: fromPackage('DatePicker') },
  'context-menu': { className: 'ContextMenu', template: fromPackage('ContextMenu') },
  'input-otp': { className: 'InputOTP', template: fromPackage('InputOTP') },
  typography: { className: 'Typography', template: fromPackage('Typography') },
  drawer: { className: 'Drawer', template: fromPackage('Drawer') },
  sidebar: { className: 'Sidebar', template: fromPackage('Sidebar') },
  'native-select': { className: 'NativeSelect', template: fromPackage('NativeSelect') },
  'input-group': { className: 'InputGroup', template: fromPackage('InputGroup') },
  item: { className: 'Item', template: fromPackage('Item') },
  bubble: { className: 'Bubble', template: fromPackage('Bubble') },
  message: { className: 'Message', template: fromPackage('Message') },
  'message-scroller': { className: 'MessageScroller', template: fromPackage('MessageScroller') },
  marker: { className: 'Marker', template: fromPackage('Marker') },
  attachment: { className: 'Attachment', template: fromPackage('Attachment') },
  'password-input': { className: 'PasswordInput', template: fromPackage('PasswordInput') },
  'multi-select': { className: 'MultiSelect', template: fromPackage('MultiSelect') },
};
