/**
 * Builds the app model (`cossack specs`): routes from route discovery, and
 * classes, methods, props, state, resources, comments and render() UI trees
 * from the project's TypeScript program. No project module is executed.
 * The schema lives in `@cossackframework/core/app-model`.
 */
import path from 'node:path';
import ts from 'typescript-api';
import { findTemplates } from '@cossackframework/renderer/diagnostics';
import { APP_MODEL_SCHEMA_VERSION } from '@cossackframework/core/app-model';
import { buildEffectiveRouteModel } from './scan-routes.js';
import { readProjectConfig, isCheckedFile } from './template-check.js';
import { readPackageVersion } from './pkg.js';

const STATE = new Set(['State', 'ClientState', 'Store', 'ClientStore']);
const SERVER = new Set(['Server', 'ServerTask']);
const TASK = new Set(['Task']);
const CLIENT = new Set(['Client', 'ClientTask', 'VisibleTask', 'OnEvent', 'On', 'OnDocument', 'OnWindow', 'PreventNavigation']);
const LIFECYCLE = new Set(['render', 'init', 'head', 'onMount', 'onCleanup', 'onNavigateComplete', 'connectedCallback',
  'disconnectedCallback', 'willUpdate', 'updated', 'firstUpdated', 'shouldUpdate']);
const COMPONENT_BASES = new Set(['Cossack', 'CossackElement']);

const toPosix = file => file.split(path.sep).join('/');

const unwrap = node => {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
};

/** A literal decorator argument as JSON; other code as `{ $expression }`. */
function jsonOf(node) {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isArrayLiteralExpression(node) && !node.elements.some(ts.isSpreadElement)) return node.elements.map(jsonOf);
  if (ts.isObjectLiteralExpression(node) && node.properties.every(property => ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)))) {
    return Object.fromEntries(node.properties.map(property => [property.name.text, jsonOf(property.initializer)]));
  }
  return { $expression: node.getText() };
}

/**
 * Build the app model of the project at `root`.
 * @returns {Promise<import('@cossackframework/core/app-model').AppModel>}
 */
export async function buildAppModel(root, { environment } = {}) {
  root = path.resolve(root);
  const effective = await buildEffectiveRouteModel(root, { environment });
  const routeFile = file => file.replace(/^\//, '');
  const routes = effective.pages.map(page => ({
    path: page.route, kind: page.kind, file: routeFile(page.filePath),
    className: page.moduleExport?.className ?? null,
    params: (page.params ?? []).map(param => typeof param === 'string' ? param : param.name),
    layouts: (page.layouts ?? page.layoutPaths ?? []).map(routeFile),
    transport: page.transport ?? null, stateful: page.stateful ?? null, ssg: page.ssg ?? null,
  }));
  const layouts = effective.layouts.map(layout => ({
    file: routeFile(layout.filePath), scope: layout.scope, className: layout.moduleExport?.className ?? null,
    services: (layout.services ?? []).map(String),
  }));
  const pageClasses = new Set(routes.filter(route => route.className).map(route => `${route.file}#${route.className}`));
  const layoutClasses = new Set(layouts.filter(layout => layout.className).map(layout => `${layout.file}#${layout.className}`));

  const { options, fileNames } = readProjectConfig(root);
  const program = ts.createProgram(fileNames, options);
  const checker = program.getTypeChecker();
  const files = program.getSourceFiles().filter(file => isCheckedFile(root, file.fileName))
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  const classes = [];
  for (const sourceFile of files) classes.push(...new FileModel(root, sourceFile, checker, { pageClasses, layoutClasses }).classes());
  return {
    schemaVersion: APP_MODEL_SCHEMA_VERSION,
    generator: { name: 'cossack', version: readPackageVersion() },
    routes, layouts, classes,
  };
}

class FileModel {
  constructor(root, sourceFile, checker, kinds) {
    this.root = root;
    this.sourceFile = sourceFile;
    this.checker = checker;
    this.kinds = kinds;
    this.file = toPosix(path.relative(root, sourceFile.fileName));
    this.templates = new Map(findTemplates(ts, sourceFile, checker).map(template => [template.node, template]));
  }

  location(node, position = node.getStart(this.sourceFile)) {
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(position);
    return { file: this.file, line: line + 1, column: character + 1 };
  }

  type(node) {
    return this.checker.typeToString(this.checker.getTypeAtLocation(node));
  }

  comment(node) {
    const symbol = node.name && this.checker.getSymbolAtLocation(node.name);
    const documentation = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(this.checker)).trim() : '';
    if (documentation) return documentation;
    const text = this.sourceFile.text;
    const lines = (ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [])
      .map(range => text.slice(range.pos, range.end))
      .map(comment => comment.startsWith('//') ? comment.replace(/^\/\/\s?/, '') : comment.replace(/^\/\*+|\*+\/$/g, '').split('\n').map(line => line.replace(/^\s*\*\s?/, '')).join('\n'))
      .join('\n').trim();
    return lines || null;
  }

  decorators(node) {
    return (ts.canHaveDecorators(node) ? ts.getDecorators(node) ?? [] : []).map(decorator => {
      const expression = decorator.expression;
      const callee = ts.isCallExpression(expression) ? expression.expression : expression;
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(this.sourceFile);
      return { name, arguments: ts.isCallExpression(expression) ? expression.arguments.map(jsonOf) : [] };
    });
  }

  classes() {
    const out = [];
    const visit = node => {
      if (ts.isClassDeclaration(node) || (ts.isClassExpression(node) && node.name)) out.push(this.classModel(node));
      if (!ts.isClassLike(node)) ts.forEachChild(node, visit);
    };
    ts.forEachChild(this.sourceFile, visit);
    return out;
  }

  isComponentClass(node) {
    const symbol = node.name && this.checker.getSymbolAtLocation(node.name);
    if (!symbol) return false;
    const seen = new Set();
    const bases = type => this.checker.getBaseTypes(type).flatMap(base => {
      const name = base.symbol?.name;
      if (!name || seen.has(name)) return [];
      seen.add(name);
      return [name, ...(base.isClassOrInterface() ? bases(base) : [])];
    });
    const type = this.checker.getDeclaredTypeOfSymbol(symbol);
    return type.isClassOrInterface() && bases(type).some(name => COMPONENT_BASES.has(name));
  }

  classModel(node) {
    const name = node.name?.text ?? 'default';
    const decorators = this.decorators(node);
    const decorated = new Set(decorators.map(decorator => decorator.name));
    const key = `${this.file}#${name}`;
    const kind = this.kinds.pageClasses.has(key) ? 'page' : this.kinds.layoutClasses.has(key) ? 'layout'
      : decorated.has('Service') ? 'service'
        : decorated.has('Component') || decorated.has('Page') || this.isComponentClass(node) ? 'component' : 'class';
    const modifiers = ts.getModifiers(node) ?? [];
    const heritage = node.heritageClauses?.find(clause => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0];
    const members = node.members;
    const state = [];
    const services = [];
    const resources = [];
    let props = null;
    for (const member of members) {
      if (!ts.isPropertyDeclaration(member) || !member.name || !ts.isIdentifier(member.name)) continue;
      const memberDecorators = this.decorators(member);
      const stateDecorator = memberDecorators.find(decorator => STATE.has(decorator.name));
      const inject = memberDecorators.find(decorator => decorator.name === 'Inject');
      const initializer = member.initializer && unwrap(member.initializer);
      if (member.name.text === 'props') props = this.props(member);
      else if (stateDecorator) {
        state.push({ name: member.name.text, decorator: stateDecorator.name, type: this.type(member.name),
          initial: member.initializer?.getText(this.sourceFile) ?? null, comment: this.comment(member), location: this.location(member.name) });
      } else if (inject) {
        const call = this.decoratorExpression(member, 'Inject');
        services.push({ name: member.name.text, service: call?.arguments[0]?.getText(this.sourceFile) ?? '' });
      } else if (initializer && ts.isCallExpression(initializer) && ts.isIdentifier(initializer.expression) && initializer.expression.text === 'server$') {
        resources.push({ name: member.name.text, type: this.type(member.name), source: initializer.arguments[0]?.getText(this.sourceFile) ?? '',
          comment: this.comment(member), location: this.location(member.name) });
      }
    }
    const methods = members.filter(member => ts.isMethodDeclaration(member) || (ts.isGetAccessorDeclaration(member) && this.decorators(member).some(decorator => decorator.name === 'Computed')))
      .filter(member => member.name && !ts.isPrivateIdentifier(member.name))
      .map(member => this.method(member));
    const render = members.find(member => ts.isMethodDeclaration(member) && member.name?.getText(this.sourceFile) === 'render' && member.body);
    return {
      name, kind, location: this.location(node.name ?? node), exported: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword),
      extends: heritage?.getText(this.sourceFile) ?? null, decorators, comment: this.comment(node), props, state, methods, resources, services,
      render: render ? new RenderTree(this, render).nodes() : null,
    };
  }

  decoratorExpression(node, name) {
    return (ts.getDecorators(node) ?? []).map(decorator => decorator.expression)
      .find(expression => ts.isCallExpression(expression) && expression.expression.getText(this.sourceFile) === name);
  }

  props(member) {
    const type = this.checker.getTypeAtLocation(member.name);
    const typeText = member.type?.getText(this.sourceFile) ?? this.checker.typeToString(type);
    // Members the application declares, not attribute maps from packages.
    const properties = this.checker.getPropertiesOfType(this.checker.getNonNullableType(type)).filter(property =>
      (property.declarations ?? []).some(declaration => isCheckedFile(this.root, declaration.getSourceFile().fileName)));
    return {
      type: typeText,
      members: properties.map(property => ({
        name: property.name, type: this.checker.typeToString(this.checker.getTypeOfSymbolAtLocation(property, member)),
        optional: !!(property.flags & ts.SymbolFlags.Optional),
        comment: ts.displayPartsToString(property.getDocumentationComment(this.checker)).trim() || null,
      })),
    };
  }

  method(member) {
    const decorators = this.decorators(member);
    const names = new Set(decorators.map(decorator => decorator.name));
    const name = member.name.getText(this.sourceFile);
    const kind = [...names].some(item => SERVER.has(item)) ? 'server' : [...names].some(item => CLIENT.has(item)) ? 'client'
      : names.has('Shared') ? 'shared' : names.has('Computed') ? 'computed' : [...names].some(item => TASK.has(item)) ? 'task'
        : LIFECYCLE.has(name) ? 'lifecycle' : 'method';
    const signature = this.checker.getSignatureFromDeclaration(member);
    const modifiers = ts.getModifiers(member) ?? [];
    return {
      name, kind, decorators,
      parameters: member.parameters.map(parameter => ({ name: parameter.name.getText(this.sourceFile), type: this.type(parameter.name),
        optional: !!parameter.questionToken || !!parameter.initializer })),
      returnType: signature ? this.checker.typeToString(this.checker.getReturnTypeOfSignature(signature)) : 'unknown',
      async: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword),
      static: modifiers.some(modifier => modifier.kind === ts.SyntaxKind.StaticKeyword),
      comment: this.comment(member), location: this.location(member.name),
    };
  }
}

/** The UI tree a render() method returns. */
class RenderTree {
  constructor(file, method) {
    this.file = file;
    this.method = method;
    // `const` values in render() are expanded where the template uses them.
    this.constants = new Map();
    const visit = node => {
      if (ts.isVariableStatement(node) && node.declarationList.flags & ts.NodeFlags.Const) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer) this.constants.set(declaration.name.text, declaration.initializer);
        }
      }
      if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
    };
    ts.forEachChild(method.body, visit);
    this.expanding = new Set();
  }

  nodes() {
    return this.results(this.method.body, this.method);
  }

  /** The nodes of every return of a function body. */
  results(body, owner) {
    if (!ts.isBlock(body)) return this.expression(body);
    const returns = [];
    const visit = node => {
      if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
      else if (!ts.isFunctionLike(node)) ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
    if (returns.length === 1) return this.expression(returns[0]);
    if (returns.length === 0) return [];
    return [this.control('returns', null, owner, returns.map(expression => ({
      label: `line ${this.file.location(expression).line}`, nodes: this.expression(expression) })))];
  }

  callback(node) {
    node = unwrap(node);
    return ts.isArrowFunction(node) || ts.isFunctionExpression(node) ? this.results(node.body, node) : this.expression(node);
  }

  control(control, source, node, branches, extra = {}) {
    return { kind: 'control', control, source: source ? source.getText(this.file.sourceFile) : null, ...extra, branches, location: this.file.location(node) };
  }

  expressionNode(node) {
    return { kind: 'expression', source: node.getText(this.file.sourceFile), type: this.file.type(node), location: this.file.location(node) };
  }

  expression(input) {
    const node = unwrap(input);
    const sourceFile = this.file.sourceFile;
    const template = ts.isTaggedTemplateExpression(node) && this.file.templates.get(node);
    if (template) return this.template(template);
    if (ts.isConditionalExpression(node)) {
      return [this.control('conditional', node.condition, node, [
        { label: 'true', nodes: this.expression(node.whenTrue) }, { label: 'false', nodes: this.expression(node.whenFalse) }])];
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return [this.control('and', node.left, node, [{ label: 'true', nodes: this.expression(node.right) }])];
      if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
        return [this.control('or', node.left, node, [{ label: 'value', nodes: this.expression(node.left) }, { label: 'fallback', nodes: this.expression(node.right) }])];
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : '';
      const args = node.arguments;
      const parameters = fn => {
        fn = fn && unwrap(fn);
        return fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) ? fn.parameters.map(parameter => parameter.name.getText(sourceFile)) : [];
      };
      if ((name === 'map' || name === 'flatMap') && ts.isPropertyAccessExpression(callee) && args[0]) {
        return [this.control('map', callee.expression, node, [{ label: 'item', nodes: this.callback(args[0]) }], { parameters: parameters(args[0]) })];
      }
      if (name === 'map' && ts.isIdentifier(callee) && args.length >= 2) {
        return [this.control('map', args[0], node, [{ label: 'item', nodes: this.callback(args[1]) }], { parameters: parameters(args[1]) })];
      }
      if (name === 'repeat' && args.length >= 2) {
        const template = args[args.length - 1];
        return [this.control('repeat', args[0], node, [{ label: 'item', nodes: this.callback(template) }],
          { parameters: parameters(template), ...(args.length >= 3 ? { key: args[1].getText(sourceFile) } : {}) })];
      }
      if (name === 'when' && args.length >= 2) {
        return [this.control('when', args[0], node, [{ label: 'true', nodes: this.callback(args[1]) },
          ...(args[2] ? [{ label: 'false', nodes: this.callback(args[2]) }] : [])])];
      }
      if (name === 'choose' && args.length >= 2) {
        const cases = unwrap(args[1]);
        const branches = ts.isArrayLiteralExpression(cases) ? cases.elements.map(entry => {
          entry = unwrap(entry);
          return ts.isArrayLiteralExpression(entry) && entry.elements.length >= 2
            ? { label: entry.elements[0].getText(sourceFile), nodes: this.callback(entry.elements[1]) }
            : { label: entry.getText(sourceFile), nodes: [] };
        }) : [];
        if (args[2]) branches.push({ label: 'default', nodes: this.callback(args[2]) });
        return [this.control('choose', args[0], node, branches)];
      }
      if (name === 'guard' && args[1]) return this.callback(args[1]);
      if ((name === 'cache' || name === 'live') && args[0]) return this.expression(args[0]);
      if (name === 'key' && args[1]) return this.expression(args[1]);
      if (name === 'component' && ts.isIdentifier(callee) && args[0]) return [this.componentCall(node)];
    }
    if (ts.isIdentifier(node) && this.constants.has(node.text) && !this.expanding.has(node.text)) {
      this.expanding.add(node.text);
      try { return this.expression(this.constants.get(node.text)); } finally { this.expanding.delete(node.text); }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      return text ? [{ kind: 'text', text }] : [];
    }
    return [this.expressionNode(node)];
  }

  componentCall(node) {
    const [clazz, props, children] = node.arguments;
    const sourceFile = this.file.sourceFile;
    const attributes = [];
    const object = props && unwrap(props);
    if (object && ts.isObjectLiteralExpression(object)) {
      for (const property of object.properties) {
        if (ts.isSpreadAssignment(property)) attributes.push({ name: '...', kind: 'spread', binding: this.binding(property.expression) });
        else if (ts.isShorthandPropertyAssignment(property)) attributes.push({ name: property.name.text, kind: 'attribute', binding: this.binding(property.name) });
        else if (ts.isPropertyAssignment(property)) {
          const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)
            ? property.name.text : property.name.getText(sourceFile);
          const value = unwrap(property.initializer);
          const kind = attributeKind(name);
          if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) attributes.push({ name, kind, value: value.text });
          else attributes.push({ name, kind, binding: this.binding(property.initializer) });
        }
      }
    } else if (object) attributes.push({ name: '...', kind: 'spread', binding: this.binding(object) });
    return { kind: 'component', class: clazz.getText(sourceFile), props: attributes,
      children: children ? this.expression(children) : [], location: this.file.location(node) };
  }

  binding(node) {
    return { source: node.getText(this.file.sourceFile), type: this.file.type(node) };
  }

  template(template) {
    const convert = nodes => nodes.flatMap(node => {
      switch (node.type) {
        case 'element':
          return [{ kind: 'element', tag: node.tag, namespace: node.namespace, attributes: node.attributes.map(attribute => this.attribute(template, attribute)),
            children: convert(node.children), location: this.file.location(template.node, template.position(node.startTag.start)) }];
        case 'component':
          return [{ kind: 'component', class: template.expressions[node.binding]?.getText(this.file.sourceFile) ?? '',
            props: node.attributes.map(attribute => this.attribute(template, attribute)), children: convert(node.children),
            location: this.file.location(template.node, template.position(node.startTag.start)) }];
        case 'text': {
          const text = node.text.replace(/\s+/g, ' ').trim();
          return text ? [{ kind: 'text', text }] : [];
        }
        case 'binding': {
          const expression = template.expressions[node.binding];
          if (!expression) return [];
          return node.rawText ? [this.expressionNode(expression)] : this.expression(expression);
        }
        default:
          return [];
      }
    });
    return convert(template.parsed.nodes);
  }

  attribute(template, attribute) {
    const { name, bindings, segments } = attribute;
    const kind = attributeKind(name);
    if (bindings.length === 0) return { name, kind, value: attribute.hasValue ? segments[0] : null };
    if (bindings.length === 1 && segments.every(segment => segment === '')) return { name, kind, binding: this.binding(template.expressions[bindings[0]]) };
    const parts = [];
    segments.forEach((segment, index) => {
      if (segment) parts.push(segment);
      if (index < bindings.length) parts.push(this.binding(template.expressions[bindings[index]]));
    });
    return { name, kind, parts };
  }
}

const attributeKind = name => name === '...' ? 'spread' : name[0] === '.' ? 'property' : name[0] === '?' ? 'boolean' : name[0] === '@' ? 'event' : 'attribute';
