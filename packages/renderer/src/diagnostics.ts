/**
 * Template diagnostics for `html` and `svg` templates.
 *
 * One analysis serves the Vite plugin, `cossack check templates` and the
 * TypeScript language service plugin. Structural rules come from the
 * renderer's own template parser and need no types: malformed markup,
 * bindings that render nothing, unknown binding prefixes, component tags
 * that do not close, and template literals with markup but no `html` tag.
 * Type rules read the project's TypeScript program: attribute names and
 * values against the native attribute map (`TemplateTypeMap`), `@event`
 * handlers, `?attr` booleans, `.prop` properties, and component tag
 * attributes against the component's `props`.
 *
 * The caller passes the TypeScript compiler API module that created the
 * program, so this module never loads a compiler of its own.
 */
import type * as TS from 'typescript-api';
import { decodeEntities } from './component-tags';
import {
  parseTemplate, templateContextAt, type ParsedTemplate, type TemplateAttribute, type TemplateComponent, type TemplateElement,
  type TemplateLocation, type TemplateNode,
} from './template-parse';

export { parseTemplate, templateContextAt } from './template-parse';
export type {
  TemplateContext, TemplateContextTag, ParsedTemplate, TemplateAttribute, TemplateBindingNode, TemplateBindingRole, TemplateComment, TemplateComponent,
  TemplateElement, TemplateLocation, TemplateNamespace, TemplateNode, TemplateProblem, TemplateRange, TemplateText,
} from './template-parse';

type TypeScript = typeof TS;

export type TemplateDiagnosticSeverity = 'error' | 'warning' | 'hint';

export interface TemplateDiagnostic {
  readonly code: string;
  readonly severity: TemplateDiagnosticSeverity;
  readonly message: string;
  /** The file name as the program knows it. */
  readonly file: string;
  /** Offset of the first character in the file. */
  readonly start: number;
  readonly length: number;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

/** One `html` or `svg` tagged template in a source file. */
export interface TemplateSource {
  readonly node: TS.TaggedTemplateExpression;
  readonly kind: 'html' | 'svg';
  /** The cooked strings, as the tag function receives them. */
  readonly strings: readonly string[];
  readonly expressions: readonly TS.Expression[];
  readonly parsed: ParsedTemplate;
  /** The file that declares the tag function, when a type checker resolved it. */
  readonly declarationFile?: TS.SourceFile;
  /** The file offset of a location in the template's strings. */
  position(location: TemplateLocation): number;
  /** The location of a file offset in the template's strings; undefined inside a binding or outside the template. */
  locationAt(position: number): TemplateLocation | undefined;
}

export interface TemplateCheckOptions {
  /** Set to false for structural rules only. */
  readonly types?: boolean;
  /** Report hints, such as component() calls that could be component tags. Default true. */
  readonly hints?: boolean;
  /** Decides whether a declaration file belongs to the renderer. */
  readonly isRendererFile?: (fileName: string) => boolean;
}

const RENDERER_FILE = /[\\/](?:@cossackframework[\\/]renderer|packages[\\/]renderer)[\\/]/;

/** A template literal with tag-like markup, such as `<b>` or `</p>`. */
const MARKUP = /<[A-Za-z/!]/;

// --- Finding templates ---

/** Map offsets in a literal's cooked text to offsets in its source text, and back. */
const cookedOffsets = (source: string): { toSource(offset: number): number; toCooked(offset: number): number } => {
  if (!source.includes('\\') && !source.includes('\r')) return { toSource: (offset) => offset, toCooked: (offset) => offset };
  const map: number[] = [];
  for (let r = 0; r < source.length;) {
    const ch = source[r];
    if (ch === '\r') {
      map.push(r);
      r += source[r + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch !== '\\') {
      map.push(r++);
      continue;
    }
    const start = r;
    const next = source[r + 1];
    let produced = 1;
    if (next === '\r') {
      r += source[r + 2] === '\n' ? 3 : 2;
      produced = 0;
    } else if (next === '\n' || next === '\u2028' || next === '\u2029') {
      r += 2;
      produced = 0;
    } else if (next === 'x') {
      r += 4;
    } else if (next === 'u' && source[r + 2] === '{') {
      const close = source.indexOf('}', r);
      produced = parseInt(source.slice(r + 3, close), 16) > 0xffff ? 2 : 1;
      r = close + 1;
    } else if (next === 'u') {
      r += 6;
    } else {
      r += 2;
    }
    for (let k = 0; k < produced; k++) map.push(start);
  }
  map.push(source.length);
  return {
    toSource: (offset) => map[Math.min(offset, map.length - 1)],
    toCooked: (offset) => {
      let cooked = 0;
      while (cooked + 1 < map.length && map[cooked + 1] <= offset) cooked++;
      return cooked;
    },
  };
};

const symbolOf = (ts: TypeScript, checker: TS.TypeChecker, node: TS.Node): TS.Symbol | undefined => {
  const symbol = checker.getSymbolAtLocation(node);
  return symbol && symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
};

/** The renderer function a callee or tag resolves to, by name, with its declaring file. */
const rendererFunction = (ts: TypeScript, node: TS.Expression, checker: TS.TypeChecker | undefined, options: TemplateCheckOptions) => {
  const target = ts.isPropertyAccessExpression(node) ? node.name : ts.isIdentifier(node) ? node : undefined;
  if (!target) return undefined;
  if (!checker) return { name: target.text, file: undefined };
  const symbol = symbolOf(ts, checker, target);
  const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
  if (!symbol || !declaration) return undefined;
  const file = declaration.getSourceFile();
  return (options.isRendererFile ?? ((name: string) => RENDERER_FILE.test(name)))(file.fileName) ? { name: symbol.name, file } : undefined;
};

const templateParts = (ts: TypeScript, literal: TS.TemplateLiteral): TS.TemplateLiteralLikeNode[] =>
  ts.isNoSubstitutionTemplateLiteral(literal) ? [literal] : [literal.head, ...literal.templateSpans.map((span) => span.literal)];

/** Every `html` and `svg` tagged template in a file, outermost first. */
export const findTemplates = (ts: TypeScript, sourceFile: TS.SourceFile, checker?: TS.TypeChecker, options: TemplateCheckOptions = {}): TemplateSource[] => {
  const found: TemplateSource[] = [];
  const visit = (node: TS.Node) => {
    if (ts.isTaggedTemplateExpression(node)) {
      const fn = rendererFunction(ts, node.tag, checker, options);
      if (fn && (fn.name === 'html' || fn.name === 'svg')) found.push(templateSource(ts, sourceFile, node, fn.name, fn.file));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
};

const templateSource = (ts: TypeScript, sourceFile: TS.SourceFile, node: TS.TaggedTemplateExpression, kind: 'html' | 'svg', declarationFile?: TS.SourceFile): TemplateSource => {
  const parts = templateParts(ts, node.template);
  const text = sourceFile.text;
  const starts: number[] = [];
  const ends: number[] = [];
  const maps: ReturnType<typeof cookedOffsets>[] = [];
  for (const part of parts) {
    const start = part.getStart(sourceFile) + 1;
    const end = part.getEnd() - (part.kind === ts.SyntaxKind.TemplateHead || part.kind === ts.SyntaxKind.TemplateMiddle ? 2 : 1);
    starts.push(start);
    ends.push(end);
    maps.push(cookedOffsets(text.slice(start, end)));
  }
  const strings = parts.map((part) => part.text);
  const expressions = ts.isNoSubstitutionTemplateLiteral(node.template) ? [] : node.template.templateSpans.map((span) => span.expression);
  return {
    node, kind, strings, expressions, declarationFile,
    parsed: parseTemplate(strings, { svg: kind === 'svg' }),
    position: (location) => starts[location.string] + maps[location.string].toSource(location.offset),
    locationAt: (position) => {
      const string = starts.findIndex((start, index) => position >= start && position <= ends[index]);
      return string < 0 ? undefined : { string, offset: maps[string].toCooked(position - starts[string]) };
    },
  };
};

// --- Checking ---

interface TemplateTypes {
  html: TS.Type; svg: TS.Type; global: TS.Type; svgGlobal: TS.Type; htmlElements: TS.Type; svgElements: TS.Type;
  omitted: TS.Type; ifDefined: TS.Type; live: TS.Type; bind: TS.Type; preventDefault: TS.Type;
  boolean: TS.Type; listener: TS.Type; ref: TS.Type; component: TS.Type;
}

const TYPE_MEMBERS = ['html', 'svg', 'global', 'svgGlobal', 'htmlElements', 'svgElements', 'omitted', 'ifDefined', 'live',
  'bind', 'preventDefault', 'boolean', 'listener', 'ref', 'component'] as const;

const typeCache = new WeakMap<TS.TypeChecker, Map<TS.SourceFile, TemplateTypes | null>>();

/** Read `TemplateTypeMap` from the module that declares the template tag. */
const templateTypes = (ts: TypeScript, checker: TS.TypeChecker, file: TS.SourceFile): TemplateTypes | null => {
  let byFile = typeCache.get(checker);
  if (!byFile) typeCache.set(checker, byFile = new Map());
  if (byFile.has(file)) return byFile.get(file)!;
  let result: TemplateTypes | null = null;
  const moduleSymbol = checker.getSymbolAtLocation(file);
  const exported = moduleSymbol && checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.name === 'TemplateTypeMap');
  if (exported) {
    const map = checker.getDeclaredTypeOfSymbol(exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported);
    const members: Partial<TemplateTypes> = {};
    for (const name of TYPE_MEMBERS) {
      const member = checker.getPropertyOfType(map, name);
      if (member) members[name] = checker.getTypeOfSymbol(member);
    }
    if (TYPE_MEMBERS.every((name) => members[name])) result = members as TemplateTypes;
  }
  byFile.set(file, result);
  return result;
};

/** Check the templates of one source file. `ts` is the module that created `program`. */
export const checkTemplates = (ts: TypeScript, program: TS.Program, sourceFile: TS.SourceFile, options: TemplateCheckOptions = {}): TemplateDiagnostic[] => {
  const checker = options.types === false ? undefined : program.getTypeChecker();
  const diagnostics: TemplateDiagnostic[] = [];
  const report = (code: string, severity: TemplateDiagnosticSeverity, message: string, start: number, end: number) => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
    diagnostics.push({ code, severity, message, file: sourceFile.fileName, start, length: Math.max(end - start, 1), line: line + 1, column: character + 1 });
  };
  const reportNode = (code: string, severity: TemplateDiagnosticSeverity, message: string, node: TS.Node) =>
    report(code, severity, message, node.getStart(sourceFile), node.getEnd());

  for (const template of findTemplates(ts, sourceFile, checker, options)) {
    const at = (range: { start: TemplateLocation; end: TemplateLocation }) => [template.position(range.start), template.position(range.end)] as const;
    for (const problem of template.parsed.problems) report(problem.code, problem.severity, problem.message, ...at(problem.range));
    checkExpressions(ts, template, reportNode);
    const types = checker && template.declarationFile ? templateTypes(ts, checker, template.declarationFile) : null;
    if (checker && types) new TypeRules(ts, checker, types, template, report, reportNode).nodes(template.parsed.nodes);
  }
  checkComponentCalls(ts, sourceFile, checker, options, reportNode);
  return diagnostics.sort((a, b) => a.start - b.start || a.code.localeCompare(b.code));
};

type ReportNode = (code: string, severity: TemplateDiagnosticSeverity, message: string, node: TS.Node) => void;

const unwrap = (ts: TypeScript, expression: TS.Expression): TS.Expression => {
  while (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    expression = expression.expression;
  }
  return expression;
};

/** Expressions a rendered value is built from: branches, list items and callback results. */
const renderedExpressions = (ts: TypeScript, expression: TS.Expression, out: TS.Expression[] = []): TS.Expression[] => {
  const node = unwrap(ts, expression);
  out.push(node);
  if (ts.isConditionalExpression(node)) {
    renderedExpressions(ts, node.whenTrue, out);
    renderedExpressions(ts, node.whenFalse, out);
  } else if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) renderedExpressions(ts, node.right, out);
    else if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      renderedExpressions(ts, node.left, out);
      renderedExpressions(ts, node.right, out);
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) renderedExpressions(ts, ts.isSpreadElement(element) ? element.expression : element, out);
  } else if (ts.isCallExpression(node)) {
    const callee = unwrap(ts, node.expression);
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
    const callbacks = name === 'map' || name === 'flatMap' ? (ts.isPropertyAccessExpression(callee) ? [node.arguments[0]] : [node.arguments[1]])
      : name === 'repeat' ? [node.arguments[node.arguments.length - 1]]
        : name === 'when' ? [node.arguments[1], node.arguments[2]]
          : name === 'guard' ? [node.arguments[1]]
            : name === 'cache' ? [node.arguments[0]]
              : name === 'key' ? [node.arguments[1]]
                : [];
    for (const callback of callbacks) if (callback) callbackResults(ts, callback, out);
  }
  return out;
};

const callbackResults = (ts: TypeScript, callback: TS.Expression, out: TS.Expression[]) => {
  const node = unwrap(ts, callback);
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) {
    renderedExpressions(ts, node, out);
    return;
  }
  if (!ts.isBlock(node.body)) {
    renderedExpressions(ts, node.body, out);
    return;
  }
  const visit = (child: TS.Node) => {
    if (ts.isReturnStatement(child) && child.expression) renderedExpressions(ts, child.expression, out);
    else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
  };
  visit(node.body);
};

/** Report template literals that render markup as text. */
const untaggedMarkup = (ts: TypeScript, expression: TS.Expression, reportNode: ReportNode) => {
  for (const node of renderedExpressions(ts, expression)) {
    if (!ts.isNoSubstitutionTemplateLiteral(node) && !ts.isTemplateExpression(node)) continue;
    const text = ts.isNoSubstitutionTemplateLiteral(node) ? node.text : [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('');
    if (MARKUP.test(text)) {
      reportNode('COSSACK_TEMPLATE_UNTAGGED_MARKUP', 'error', 'This template literal renders as escaped text, not markup. Tag it: html`...`.', node);
    }
  }
};

const expressionKey = (expression: TS.Expression) => expression.getText().replace(/\s+/g, '');

/** Rules on binding expressions that need no types. */
const checkExpressions = (ts: TypeScript, template: TemplateSource, reportNode: ReportNode) => {
  template.parsed.bindings.forEach((role, index) => {
    const expression = template.expressions[index];
    if (!expression) return;
    if (role.kind === 'node') untaggedMarkup(ts, expression, reportNode);
    else if (role.kind === 'tag' && role.closing) {
      const open = template.expressions[role.component.binding];
      if (open && expressionKey(open) !== expressionKey(expression)) {
        reportNode('COSSACK_TEMPLATE_COMPONENT_CLOSE_MISMATCH', 'error',
          `This closing tag binds ${expression.getText()}, but its opening tag binds ${open.getText()}. Close a component tag with the same class.`, expression);
      }
    }
  });
};

/** component() calls: markup children without a tag, and literal classes that could be tags. */
const checkComponentCalls = (ts: TypeScript, sourceFile: TS.SourceFile, checker: TS.TypeChecker | undefined, options: TemplateCheckOptions, reportNode: ReportNode) => {
  const visit = (node: TS.Node) => {
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const fn = rendererFunction(ts, node.expression, checker, options);
      if (fn?.name === 'component') {
        if (node.arguments[2]) untaggedMarkup(ts, node.arguments[2], reportNode);
        const target = unwrap(ts, node.arguments[0]);
        const reference = ts.isExpressionWithTypeArguments(target) ? target.expression : target;
        const isClass = checker
          ? !!(symbolOf(ts, checker, reference)?.flags ?? 0) && !!(symbolOf(ts, checker, reference)!.flags & ts.SymbolFlags.Class)
          : ts.isIdentifier(reference) && /^[A-Z]/.test(reference.text);
        if (options.hints !== false && isClass) {
          const name = reference.getText(sourceFile);
          reportNode('COSSACK_TEMPLATE_COMPONENT_CALL', 'hint',
            `Write this as a component tag: <\${${name}} ...>...</\${${name}}>. Keep component() for classes chosen at runtime.`, node.expression);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
};

const NUMERIC = /^\s*[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?\s*$/i;

class TypeRules {
  constructor(
    private readonly ts: TypeScript,
    private readonly checker: TS.TypeChecker,
    private readonly types: TemplateTypes,
    private readonly template: TemplateSource,
    private readonly report: (code: string, severity: TemplateDiagnosticSeverity, message: string, start: number, end: number) => void,
    private readonly reportNode: ReportNode,
  ) {}

  nodes(nodes: readonly TemplateNode[]) {
    for (const node of nodes) {
      if (node.type === 'element') this.element(node);
      else if (node.type === 'component') this.component(node);
      if (node.type === 'element' || node.type === 'component') this.nodes(node.children);
    }
  }

  // --- Type helpers ---

  private propertyType(type: TS.Type, name: string): TS.Type | undefined {
    const property = this.checker.getPropertyOfType(type, name);
    if (property) return this.checker.getTypeOfSymbol(property);
    for (const info of this.checker.getIndexInfosOfType(type)) {
      if (this.checker.isTypeAssignableTo(this.checker.getStringLiteralType(name), info.keyType)) return info.type;
    }
    return undefined;
  }

  private propertySymbol(type: TS.Type, name: string): TS.Symbol | undefined {
    return this.checker.getPropertyOfType(type, name);
  }

  private parts(type: TS.Type): readonly TS.Type[] {
    return type.isUnion() ? type.types : [type];
  }

  private isAny(type: TS.Type) {
    return (type.flags & this.ts.TypeFlags.Any) !== 0;
  }

  private accepts(target: TS.Type, source: TS.Type) {
    return this.checker.isTypeAssignableTo(source, target);
  }

  /** Every part of `source` is accepted by `target`, a wrapper, or number-to-text coercion. */
  private acceptsValue(target: TS.Type, source: TS.Type, wrappers: readonly TS.Type[], coerceNumbers = false) {
    if (this.isAny(source)) return true;
    const text = coerceNumbers && this.accepts(target, this.checker.getStringType());
    const numeric = this.ts.TypeFlags.NumberLike | this.ts.TypeFlags.BigIntLike;
    return this.parts(source).every((part) => this.accepts(target, part) || wrappers.some((wrapper) => this.accepts(wrapper, part)) ||
      (text && (part.flags & numeric) !== 0));
  }

  private show(type: TS.Type) {
    // Without an enclosing node, names print without import("...") qualifiers.
    return this.checker.typeToString(type, undefined, this.ts.TypeFormatFlags.NoTruncation);
  }

  /** The values a target takes, without the ones every binding takes (null, nothing, ifDefined()...). */
  private showAccepted(target: TS.Type) {
    const { omitted, ifDefined, preventDefault, live, bind } = this.types;
    const parts = this.parts(target).filter((part) => ![omitted, ifDefined, preventDefault, live, bind].some((wrapper) => this.accepts(wrapper, part)));
    if (parts.length === 0) return this.show(target);
    const names = parts.map((part) => this.show(part));
    if (names.includes('true') && names.includes('false')) {
      names.splice(names.indexOf('true'), 1);
      names.splice(names.indexOf('false'), 1, 'boolean');
    }
    return names.join(' | ');
  }

  private wholeExpression(attribute: TemplateAttribute): TS.Expression | undefined {
    const whole = attribute.bindings.length === 1 && attribute.segments.every((segment) => segment === '');
    return whole ? this.template.expressions[attribute.bindings[0]] : undefined;
  }

  private range(attribute: TemplateAttribute, part: 'name' | 'all' = 'name'): [number, number] {
    const range = part === 'name' ? attribute.nameRange : attribute.range;
    return [this.template.position(range.start), this.template.position(range.end)];
  }

  // --- Elements ---

  private element(element: TemplateElement) {
    if (element.namespace === 'mathml') return;
    const svg = element.namespace === 'svg';
    const map = svg ? this.types.svg : this.types.html;
    const key = svg ? this.svgTag(element.tag) : element.name;
    const known = key !== undefined && !!this.propertyType(map, key);
    const attributes = known ? this.propertyType(map, key!)! : svg ? this.types.svgGlobal : this.types.global;
    const elementType = key === undefined ? undefined : this.propertyType(svg ? this.types.svgElements : this.types.htmlElements, key);
    for (const attribute of element.attributes) this.elementAttribute(element, attribute, attributes, known, elementType);
  }

  private svgTag(tag: string): string | undefined {
    if (this.checker.getPropertyOfType(this.types.svg, tag)) return tag;
    const lower = tag.toLowerCase();
    return this.checker.getPropertiesOfType(this.types.svg).find((property) => property.name.toLowerCase() === lower)?.name;
  }

  private elementAttribute(element: TemplateElement, attribute: TemplateAttribute, attributes: TS.Type, known: boolean, elementType: TS.Type | undefined) {
    const { name } = attribute;
    if (name === '...') return;
    const expression = this.wholeExpression(attribute);
    const prefix = name[0];
    // Malformed binding forms are structural problems, reported already.
    if ((prefix === '.' || prefix === '?' || prefix === '@') && !expression) return;
    const tag = `<${element.tag}>`;
    const html = element.namespace === 'html';
    const unknown = (attributeName: string) => known
      ? this.report('COSSACK_TEMPLATE_UNKNOWN_ATTRIBUTE', 'error', `${tag} has no attribute "${attributeName}".`, ...this.range(attribute))
      : this.report('COSSACK_TEMPLATE_UNKNOWN_ELEMENT_ATTRIBUTE', 'warning',
        `${tag} is not a known element, so only global attributes are known. "${attributeName}" is not one.`, ...this.range(attribute));

    if (name === 'ref') {
      if (!expression) {
        this.report('COSSACK_TEMPLATE_REF_BINDING', 'error', 'ref takes a ref object or a callback: ref=${ref}.', ...this.range(attribute, 'all'));
      } else this.value(expression, this.types.ref, [], 'COSSACK_TEMPLATE_REF_BINDING', 'ref takes a ref object or a callback');
      return;
    }
    if (prefix === '.') {
      const property = name.slice(1);
      const declared = this.propertyType(attributes, name);
      if (declared) {
        this.value(expression!, declared, [this.types.omitted], 'COSSACK_TEMPLATE_PROPERTY_TYPE', `${tag} property ${property}`);
        return;
      }
      if (!elementType) return;
      const symbol = this.propertySymbol(elementType, property);
      if (!symbol) {
        this.report('COSSACK_TEMPLATE_UNKNOWN_PROPERTY', known ? 'error' : 'warning', `${tag} has no property "${property}".`, ...this.range(attribute));
        return;
      }
      const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
      if (declaration && (this.ts.getCombinedModifierFlags(declaration) & this.ts.ModifierFlags.Readonly) !== 0) {
        this.report('COSSACK_TEMPLATE_PROPERTY_READONLY', 'error', `${tag} property ${property} is read-only.`, ...this.range(attribute));
        return;
      }
      const wrappers = property === 'value' || property === 'checked' ? [this.types.omitted, this.types.live, this.types.bind] : [this.types.omitted, this.types.live];
      this.value(expression!, this.checker.getTypeOfSymbol(symbol), wrappers, 'COSSACK_TEMPLATE_PROPERTY_TYPE', `${tag} property ${property}`);
      return;
    }
    if (prefix === '@') {
      const declared = this.propertyType(attributes, name);
      this.value(expression!, declared ?? this.types.listener, [this.types.omitted, this.types.preventDefault], 'COSSACK_TEMPLATE_EVENT_HANDLER',
        declared ? `The ${name} handler of ${tag}` : `The ${name} handler`);
      return;
    }
    if (prefix === '?') {
      const base = html ? name.slice(1).toLowerCase() : name.slice(1);
      if (!this.propertyType(attributes, base) && !this.propertyType(attributes, `?${base}`)) {
        unknown(base);
        return;
      }
      this.value(expression!, this.types.boolean, [], 'COSSACK_TEMPLATE_BOOLEAN_BINDING', `${name} on ${tag}`, ' Use a boolean, such as !!value.');
      return;
    }
    if (html && /^on[a-z]/i.test(name)) {
      this.report('COSSACK_TEMPLATE_EVENT_ATTRIBUTE', 'error', `"${name}" is an inline event attribute. Bind a listener instead: @${name.slice(2).toLowerCase()}=\${handler}.`, ...this.range(attribute));
      return;
    }
    // Names with an unknown binding prefix are structural problems.
    if (!/^[A-Za-z_]/.test(name)) return;
    const lookup = html ? name.toLowerCase() : name;
    const target = this.propertyType(attributes, lookup);
    if (!target) {
      unknown(lookup);
      return;
    }
    if (attribute.bindings.length === 0) this.staticValue(attribute, target, `${name} on ${tag}`);
    else if (expression) {
      this.value(expression, target, [this.types.omitted, this.types.ifDefined, this.types.live], 'COSSACK_TEMPLATE_ATTRIBUTE_TYPE', `${name} on ${tag}`, '', true);
    }
  }

  /** Report a bound value that `target` does not accept. */
  private value(expression: TS.Expression, target: TS.Type, wrappers: readonly TS.Type[], code: string, subject: string, advice = '', coerceNumbers = false) {
    const type = this.checker.getTypeAtLocation(expression);
    if (this.acceptsValue(target, type, wrappers, coerceNumbers)) return;
    this.reportNode(code, 'error', `${subject} takes ${this.showAccepted(target)}, not ${this.show(type)}.${advice}`, expression);
  }

  /** A static attribute value is text: check it against the attribute's values. */
  private staticValue(attribute: TemplateAttribute, target: TS.Type, subject: string) {
    const { checker } = this;
    if (!attribute.hasValue) {
      if (this.accepts(target, checker.getTrueType()) || this.accepts(target, checker.getStringLiteralType(''))) return;
      this.report('COSSACK_TEMPLATE_ATTRIBUTE_TYPE', 'error', `${subject} needs a value: it takes ${this.showAccepted(target)}.`, ...this.range(attribute));
      return;
    }
    const text = decodeEntities(attribute.segments[0]);
    if (this.accepts(target, checker.getStringLiteralType(text)) || this.accepts(target, checker.getStringLiteralType(text.toLowerCase()))) return;
    if (NUMERIC.test(text) && this.accepts(target, checker.getNumberType())) return;
    const boolean = this.accepts(target, checker.getTrueType());
    if (boolean && (text === '' || text.toLowerCase() === attribute.name.toLowerCase())) return;
    const advice = boolean && text.toLowerCase() === 'false'
      ? ' A boolean attribute is on whenever it is present; leave it out, or bind ?name=${false}.' : '';
    this.report('COSSACK_TEMPLATE_ATTRIBUTE_TYPE', 'error', `${subject} takes ${this.showAccepted(target)}, not "${text}".${advice}`, ...this.range(attribute, 'all'));
  }

  // --- Component tags ---

  private component(node: TemplateComponent) {
    const expression = this.template.expressions[node.binding];
    if (!expression) return;
    const classType = this.checker.getTypeAtLocation(expression);
    if (this.isAny(classType)) return;
    const signatures = this.checker.getSignaturesOfType(classType, this.ts.SignatureKind.Construct);
    const instance = signatures[0] && this.checker.getReturnTypeOfSignature(signatures[0]);
    const component = instance && (this.accepts(this.types.component, instance) ||
      (!!this.checker.getPropertyOfType(instance, 'render') && !!this.checker.getPropertyOfType(instance, 'props')));
    if (!component) {
      this.reportNode('COSSACK_TEMPLATE_NOT_A_COMPONENT', 'error',
        `A component tag binds a component class; ${expression.getText()} is ${this.show(classType)}.`, expression);
      return;
    }
    const propsSymbol = this.checker.getPropertyOfType(instance, 'props');
    if (!propsSymbol) return;
    const props = this.checker.getNonNullableType(this.checker.getTypeOfSymbol(propsSymbol));
    if (this.isAny(props)) return;
    const name = expression.getText();
    const given = new Set<string>();
    let spread = false;
    for (const attribute of node.attributes) {
      if (attribute.name === '...') {
        spread = true;
        continue;
      }
      given.add(attribute.name);
      this.prop(name, props, attribute);
    }
    if (spread) return;
    const missing = this.checker.getPropertiesOfType(props)
      .filter((property) => !(property.flags & this.ts.SymbolFlags.Optional) && !given.has(property.name))
      .filter((property) => !this.accepts(this.checker.getTypeOfSymbol(property), this.checker.getUndefinedType()))
      .map((property) => property.name);
    if (missing.length > 0) {
      this.report('COSSACK_TEMPLATE_MISSING_PROP', 'error', `<\${${name}}> needs ${missing.map((prop) => `"${prop}"`).join(', ')}.`,
        this.template.position(node.startTag.start), this.template.position(node.startTag.end));
    }
  }

  private prop(component: string, props: TS.Type, attribute: TemplateAttribute) {
    const target = this.propertyType(props, attribute.name);
    if (!target) {
      this.report('COSSACK_TEMPLATE_UNKNOWN_PROP', 'error', `"${attribute.name}" is not a prop of ${component}.`, ...this.range(attribute));
      return;
    }
    const expression = this.wholeExpression(attribute);
    if (expression) {
      this.value(expression, target, [], 'COSSACK_TEMPLATE_PROP_TYPE', `The ${attribute.name} prop of ${component}`);
      return;
    }
    const { checker } = this;
    const value = !attribute.hasValue ? checker.getTrueType()
      : attribute.bindings.length === 0 ? checker.getStringLiteralType(decodeEntities(attribute.segments[0]))
        : checker.getStringType();
    if (this.accepts(target, value)) return;
    const shown = !attribute.hasValue ? 'true (a bare attribute)' : attribute.bindings.length === 0 ? `"${decodeEntities(attribute.segments[0])}"` : 'text';
    const advice = attribute.hasValue && !this.accepts(target, checker.getStringType()) && !this.parts(target).some((part) => part.isStringLiteral())
      ? ` Text attributes pass strings; bind other values: ${attribute.name}=\${value}.` : '';
    this.report('COSSACK_TEMPLATE_PROP_TYPE', 'error', `The ${attribute.name} prop of ${component} takes ${this.showAccepted(target)}, not ${shown}.${advice}`,
      ...this.range(attribute, 'all'));
  }
}

// --- Completions ---

export type TemplateCompletionKind = 'element' | 'end-tag' | 'attribute' | 'event' | 'property' | 'boolean' | 'prop' | 'value';

export interface TemplateCompletion {
  readonly name: string;
  readonly kind: TemplateCompletionKind;
  /** The value type, for attributes, properties and props. */
  readonly type?: string;
}

export interface TemplateCompletions {
  readonly entries: readonly TemplateCompletion[];
  /** The text the chosen entry replaces: what was typed of the name or value. */
  readonly replace: { readonly start: number; readonly length: number };
}

/**
 * Completions at a file position inside an `html` or `svg` template: tag
 * names, end tags, attributes, `@events`, `.properties`, `?booleans`,
 * component props and enumerated values. Undefined outside a template or
 * inside a binding, where TypeScript's own completions apply.
 */
export const completeTemplate = (ts: TypeScript, program: TS.Program, sourceFile: TS.SourceFile, position: number,
  options: TemplateCheckOptions = {}): TemplateCompletions | undefined => {
  const checker = program.getTypeChecker();
  const template = findTemplates(ts, sourceFile, checker, options)
    .filter((candidate) => candidate.locationAt(position) !== undefined)
    .sort((a, b) => (a.node.getEnd() - a.node.getStart()) - (b.node.getEnd() - b.node.getStart()))[0];
  if (!template?.declarationFile) return undefined;
  const types = templateTypes(ts, checker, template.declarationFile);
  if (!types) return undefined;
  const context = templateContextAt(template.strings, template.locationAt(position)!, { svg: template.kind === 'svg' });
  const replace = (typed: string) => ({ start: position - typed.length, length: typed.length });
  const show = (type: TS.Type) => checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const names = (type: TS.Type) => checker.getPropertiesOfType(type).map((property) => property.name);
  const typeOf = (type: TS.Type, name: string) => {
    const property = checker.getPropertyOfType(type, name);
    return property && checker.getTypeOfSymbol(property);
  };
  const sorted = (entries: TemplateCompletion[]) => entries.sort((a, b) => a.name.localeCompare(b.name));

  if (context.kind === 'tag-name') {
    const map = context.namespace === 'svg' ? types.svg : types.html;
    return { entries: sorted(names(map).map((name) => ({ name, kind: 'element' }))), replace: replace(context.prefix) };
  }
  if (context.kind === 'end-tag') {
    return context.open ? { entries: [{ name: context.open.tag, kind: 'end-tag' }], replace: replace(context.prefix) } : undefined;
  }
  if (context.kind !== 'attribute-name' && context.kind !== 'attribute-value') return undefined;

  // The type that lists what this tag accepts: a component's props or an element's attributes.
  let accepted: TS.Type | undefined;
  let elementType: TS.Type | undefined;
  let component = false;
  const tag = context.tag;
  if (tag.component) {
    const expression = template.expressions[tag.binding];
    const signature = expression && checker.getSignaturesOfType(checker.getTypeAtLocation(expression), ts.SignatureKind.Construct)[0];
    const props = signature && typeOf(checker.getReturnTypeOfSignature(signature), 'props');
    accepted = props && checker.getNonNullableType(props);
    component = true;
  } else if (tag.namespace !== 'mathml') {
    const svg = tag.namespace === 'svg';
    const key = svg ? names(types.svg).find((name) => name.toLowerCase() === tag.tag.toLowerCase()) : tag.name;
    accepted = (key && typeOf(svg ? types.svg : types.html, key)) || (svg ? types.svgGlobal : types.global);
    elementType = key ? typeOf(svg ? types.svgElements : types.htmlElements, key) : undefined;
  }
  if (!accepted) return undefined;

  if (context.kind === 'attribute-value') {
    const target = typeOf(accepted, component || tag.component ? context.name : context.name.toLowerCase());
    if (!target) return undefined;
    const values = (target.isUnion() ? target.types : [target]).filter((part) => part.isStringLiteral()).map((part) => (part as TS.StringLiteralType).value);
    return values.length ? { entries: sorted(values.map((name) => ({ name, kind: 'value' }))), replace: replace(context.prefix) } : undefined;
  }

  const present = new Set(context.attributes.map((name) => component ? name : name.toLowerCase()));
  const prefix = context.prefix[0];
  const entries: TemplateCompletion[] = [];
  const add = (name: string, kind: TemplateCompletionKind, type?: TS.Type) => {
    if (!present.has(component ? name : name.toLowerCase())) entries.push({ name, kind, ...(type ? { type: show(type) } : {}) });
  };
  if (component) {
    for (const property of checker.getPropertiesOfType(accepted)) add(property.name, 'prop', checker.getTypeOfSymbol(property));
  } else if (prefix === '@') {
    for (const name of names(accepted)) if (name.startsWith('@')) add(name, 'event');
  } else if (prefix === '.') {
    for (const property of elementType ? checker.getPropertiesOfType(elementType) : []) {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      const readonly = declaration && (ts.getCombinedModifierFlags(declaration as TS.Declaration) & ts.ModifierFlags.Readonly) !== 0;
      if (!readonly && property.flags & ts.SymbolFlags.Property) add(`.${property.name}`, 'property', checker.getTypeOfSymbol(property));
    }
  } else if (prefix === '?') {
    for (const name of names(accepted)) {
      const type = typeOf(accepted, name);
      if (!/^[.?@]/.test(name) && type && checker.isTypeAssignableTo(checker.getTrueType(), type)) add(`?${name}`, 'boolean');
    }
  } else {
    for (const name of names(accepted)) if (!/^[.?@]/.test(name)) add(name, 'attribute', typeOf(accepted, name));
    add('ref', 'attribute');
    add('...', 'attribute');
  }
  return { entries: sorted(entries), replace: replace(context.prefix) };
};
