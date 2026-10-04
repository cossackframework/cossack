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
import ts from 'typescript-api';

const requireFromCli = createRequire(import.meta.url);

/** Merge repeated named imports after private helpers are included in one source file. */
function mergeNamedImports(source) {
  const file = ts.createSourceFile('ejected.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const groups = new Map();
  const edits = [];
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause || clause.name || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    const module = statement.moduleSpecifier.text;
    const bindings = groups.get(module) ?? new Map();
    groups.set(module, bindings);
    for (const item of clause.namedBindings.elements) {
      const local = item.name.text, imported = item.propertyName?.text ?? local;
      const typeOnly = clause.isTypeOnly || item.isTypeOnly;
      const previous = bindings.get(local);
      if (previous && previous.imported !== imported) throw new Error(`Conflicting ejected import: ${local}`);
      bindings.set(local, { imported, typeOnly: previous ? previous.typeOnly && typeOnly : typeOnly });
    }
    edits.push([statement.getStart(file), statement.end]);
  }
  for (const [start, end] of edits.reverse()) source = source.slice(0,start) + source.slice(end);
  const imports = [...groups].map(([module, bindings]) => `import { ${[...bindings].map(([local, item]) =>
    `${item.typeOnly ? 'type ' : ''}${item.imported}${item.imported === local ? '' : ` as ${local}`}`).join(', ')} } from ${JSON.stringify(module)};`);
  return imports.join('\n') + '\n' + source;
}

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
      const sourceName = className === 'Toaster' ? 'Toast' : className;
      const srcPath = ['AuthForm', 'CommandPalette', 'DashboardStat'].includes(className)
        ? path.join(pkgDir, 'src/blocks', className, 'index.ts')
        : path.join(pkgDir, 'src', 'components', `${sourceName}.ts`);
      return mergeNamedImports(fs.readFileSync(srcPath, 'utf8')
        // Include shared private helpers without imports into the package source tree.
        // Merge their named imports with the component imports afterward.
        .replace(
          /^import .* from ["']\.\.\/internal\/(disclosure|menu)["'];$/gm,
          (_import, name) => fs.readFileSync(path.join(pkgDir, `src/internal/${name}.ts`), 'utf8'),
        )
        .replace(/from ["'](?:\.\.\/)+native-attributes(?:\.js)?["']/g, 'from "@cossackframework/ui"')
        .replace(/from ["']\.\.\/\.\.\/components\/(?:Button|Input|PasswordInput|Label|Command|Kbd|Card)\.js["']/g, 'from "@cossackframework/ui"')
        .replace(
          /from ["'](?:\.\.\/)+icons\/Icon(?:\.js)?["']/g,
          'from "@cossackframework/ui"',
        )
        .replace(
          /from ["']\.\/Avatar["']/g,
          'from "@cossackframework/ui"',
        ));
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
  'dashboard-stat': { className: 'DashboardStat', template: fromPackage('DashboardStat') },
  'command-palette': { className: 'CommandPalette', template: fromPackage('CommandPalette') },
  'auth-form': { className: 'AuthForm', template: fromPackage('AuthForm') },
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
