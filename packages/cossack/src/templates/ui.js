// ---------------------------------------------------------------------------
// `cossack add ui` — UI component catalog
//
// Every entry reads its source from the installed @cossackframework/ui package
// at eject time, so the catalog never drifts from the package. An ejected
// component imports public package exports, plus the private helpers it needs
// from `./internal/<helper>`. `cossack add ui` copies those helpers next to the
// component once; every ejected component that uses a helper shares that copy.
// ---------------------------------------------------------------------------
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const requireFromCli = createRequire(import.meta.url);
const BLOCKS = new Set(['AuthForm', 'CommandPalette', 'DashboardStat', 'SettingsPanel']);

/** The installed UI package directory, preferring the consuming app's copy. */
function uiPackageDirectory() {
  for (const resolver of [createRequire(path.join(process.cwd(), 'package.json')), requireFromCli]) {
    try {
      return path.resolve(path.dirname(resolver.resolve('@cossackframework/ui/theme/base.css')), '../..');
    } catch {
      // Try the next resolution root.
    }
  }
  return undefined;
}

/**
 * Points package-internal imports at public exports, and private helpers at
 * `./internal/<helper>`. Adds each helper name to `helpers`.
 */
function rewriteImports(source, helpers) {
  const helper = (_import, name) => { helpers.add(name); return `from "./internal/${name}"`; };
  return source
    .replace(/from ["'](?:\.\.\/)+native-attributes(?:\.js)?["']/g, 'from "@cossackframework/ui"')
    .replace(/from ["'](?:\.\.\/)+icons\/Icon(?:\.js)?["']/g, 'from "@cossackframework/ui"')
    // A component used by another component or block comes from the package.
    .replace(/from ["'](?:\.\.\/\.\.\/components\/|\.\/)[A-Z]\w*(?:\.js)?["']/g, 'from "@cossackframework/ui"')
    .replace(/from ["'](?:\.\.\/)+internal\/([\w-]+)(?:\.js)?["']/g, helper);
}

/** A helper lives in internal/ already, so a helper it imports keeps its `./<helper>` path. */
function rewriteHelperImports(source, helpers) {
  return rewriteImports(source, helpers)
    .replace(/from ["']\.\/([a-z][\w-]*)(?:\.js)?["']/g, (_import, name) => { helpers.add(name); return `from "./${name}"`; });
}

/**
 * Reads a component's ejected source and the private helpers it imports from
 * the installed package. Before the package is installed (for example
 * `cossack add ui` before `pnpm install`), the source is a stub that explains
 * how to retry, with no helpers.
 * @returns {{ source: string, helpers: { path: string, content: string }[] }}
 */
function ejectFromPackage(className) {
  const directory = uiPackageDirectory();
  if (!directory) {
    return {
      source: `// Run \`pnpm install\` then re-run \`cossack add ui ${className.toLowerCase()}\`
// to eject the full source from @cossackframework/ui.
export {};\n`,
      helpers: [],
    };
  }
  const file = BLOCKS.has(className)
    ? path.join(directory, 'src/blocks', className, 'index.ts')
    : path.join(directory, 'src/components', `${className === 'Toaster' ? 'Toast' : className}.ts`);
  const needed = new Set();
  const source = rewriteImports(fs.readFileSync(file, 'utf8'), needed);
  const helpers = [];
  // A Set iterator also visits names that helpers add while it runs.
  for (const name of needed) {
    const content = fs.readFileSync(path.join(directory, 'src/internal', `${name}.ts`), 'utf8');
    helpers.push({ path: `internal/${name}.ts`, content: rewriteHelperImports(content, needed) });
  }
  return { source, helpers };
}

/**
 * A catalog entry. `template()` returns the component source, written to
 * `src/components/ui/<className>.ts`. `helpers()` returns the private helpers
 * it imports, written to `src/components/ui/<path>` and shared between
 * ejected components.
 */
const fromPackage = (className) => ({
  className,
  template: () => ejectFromPackage(className).source,
  helpers: () => ejectFromPackage(className).helpers,
});

/**
 * Catalog of ejectable UI components. Keys are the names accepted by
 * `cossack add ui <name>`.
 */
export const UI_COMPONENTS = {
  'settings-panel': fromPackage('SettingsPanel'),
  'dashboard-stat': fromPackage('DashboardStat'),
  'command-palette': fromPackage('CommandPalette'),
  'auth-form': fromPackage('AuthForm'),
  button: fromPackage('Button'),
  input: fromPackage('Input'),
  card: fromPackage('Card'),
  badge: fromPackage('Badge'),
  label: fromPackage('Label'),
  alert: fromPackage('Alert'),
  modal: fromPackage('Modal'),
  accordion: fromPackage('Accordion'),
  textarea: fromPackage('Textarea'),
  checkbox: fromPackage('Checkbox'),
  switch: fromPackage('Switch'),
  spinner: fromPackage('Spinner'),
  avatar: fromPackage('Avatar'),
  'avatar-group': fromPackage('AvatarGroup'),
  separator: fromPackage('Separator'),
  skeleton: fromPackage('Skeleton'),
  progress: fromPackage('Progress'),
  tabs: fromPackage('Tabs'),
  tooltip: fromPackage('Tooltip'),
  popover: fromPackage('Popover'),
  'radio-group': fromPackage('RadioGroup'),
  slider: fromPackage('Slider'),
  table: fromPackage('Table'),
  toaster: fromPackage('Toaster'),
  'dropdown-menu': fromPackage('DropdownMenu'),
  sheet: fromPackage('Sheet'),
  collapsible: fromPackage('Collapsible'),
  toggle: fromPackage('Toggle'),
  'toggle-group': fromPackage('ToggleGroup'),
  breadcrumb: fromPackage('Breadcrumb'),
  pagination: fromPackage('Pagination'),
  'aspect-ratio': fromPackage('AspectRatio'),
  field: fromPackage('Field'),
  form: fromPackage('Form'),
  empty: fromPackage('Empty'),
  kbd: fromPackage('Kbd'),
  'button-group': fromPackage('ButtonGroup'),
  'alert-dialog': fromPackage('AlertDialog'),
  'hover-card': fromPackage('HoverCard'),
  'scroll-area': fromPackage('ScrollArea'),
  resizable: fromPackage('Resizable'),
  carousel: fromPackage('Carousel'),
  'navigation-menu': fromPackage('NavigationMenu'),
  menubar: fromPackage('Menubar'),
  command: fromPackage('Command'),
  combobox: fromPackage('Combobox'),
  calendar: fromPackage('Calendar'),
  'date-picker': fromPackage('DatePicker'),
  'context-menu': fromPackage('ContextMenu'),
  'input-otp': fromPackage('InputOTP'),
  typography: fromPackage('Typography'),
  drawer: fromPackage('Drawer'),
  sidebar: fromPackage('Sidebar'),
  'native-select': fromPackage('NativeSelect'),
  'input-group': fromPackage('InputGroup'),
  item: fromPackage('Item'),
  bubble: fromPackage('Bubble'),
  message: fromPackage('Message'),
  'message-scroller': fromPackage('MessageScroller'),
  marker: fromPackage('Marker'),
  attachment: fromPackage('Attachment'),
  'password-input': fromPackage('PasswordInput'),
  'multi-select': fromPackage('MultiSelect'),
};
