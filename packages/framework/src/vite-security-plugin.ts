import type { Plugin } from 'vite';

export interface CossackSecurityPluginOptions {
  devWarning?: boolean;
}

/**
 * Vite plugin that strips server-only code from client bundles.
 *
 * This plugin transforms component source code during client builds by:
 * 1. Keeping methods decorated with @Client, @Optimistic, @Computed, @Shared
 * 2. Keeping built-in lifecycle methods: render, head, onMount, onCleanup, escapeHtml
 * 3. Keeping property getters/setters
 * 4. Replacing all other method bodies with stub functions that throw at development time
 *
 * The goal is to ensure server-only code (database queries, API keys, business logic)
 * is not exposed in the client bundle.
 *
 * Uses the Vite 6 Environment API to detect the current environment automatically.
 * Only applies stripping in the 'client' environment.
 */
export function cossackSecurityPlugin(options: CossackSecurityPluginOptions = {}): Plugin {
  const {
    devWarning = true,
  } = options;

  // Built-in methods that should always be kept in client bundles
  // Note: init() and get() are intentionally NOT included - they are server-only by default
  const BUILTIN_METHODS = new Set([
    'render',
    'head',
    'onMount',
    'onCleanup',
    'escapeHtml',
    'loadingTemplate',
    'toString',
    'valueOf',
    'clientInit', // Client-side initialization method for fake loading
    // Validation methods
    'getError',
    'hasError',
    'validateProperty',
    'validateAll',
    'clearErrors',
  ]);

  /**
   * Check if the file should be processed.
   * Only process user application code, not framework/library code.
   */
  function shouldProcessFile(id: string): boolean {
    // Skip node_modules
    if (id.includes('node_modules')) return false;

    // Skip framework packages
    if (id.includes('@cossackframework/core')) return false;
    if (id.includes('@cossackframework/renderer')) return false;
    if (id.includes('@cossackframework/auth')) return false;

    // Only process TypeScript files in user code
    return id.endsWith('.ts') || id.endsWith('.tsx') || id.endsWith('.mts');
  }

  return {
    name: 'cossack-security',
    enforce: 'pre', // Run before other plugins to ensure we process raw source

    transform(code, id) {
      // Only strip in client environment
      const isClientEnvironment = this.environment?.name === 'client';
      if (!isClientEnvironment) {
        return { code, map: null };
      }

      if (!shouldProcessFile(id)) {
        return { code, map: null };
      }

      // Check if this file contains a Cossack class
      if (!code.includes('extends Cossack') && !code.includes('extends CossackElement')) {
        return { code, map: null };
      }

      try {
        const transformed = transformCossackClass(code, id, isClientSafeMethod, BUILTIN_METHODS, devWarning);
        if (transformed !== code) {
          return { code: transformed, map: null };
        }
      } catch (error) {
        console.warn(`[Cossack Security] Error processing ${id}:`, error);
      }

      return { code, map: null };
    },
  };
}

/**
 * Transform a Cossack class by stubbing server-only methods.
 * Uses brace depth tracking to ensure only top-level methods are processed.
 */
/**
 * Build a set of character ranges that are inside strings or template literals.
 * Used to skip regex matches that fall within string/template literal regions.
 */
function buildStringRanges(code: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let i = 0;
  const len = code.length;

  while (i < len) {
    const char = code[i];
    if (char === '"' || char === "'" || char === '`') {
      const start = i;
      const end = findStringEnd(code, i, char);
      if (end === -1) break;
      ranges.push([start, end]);
      i = end + 1;
    } else if (char === '/' && i + 1 < len) {
      const next = code[i + 1];
      if (next === '/') {
        i = code.indexOf('\n', i + 2);
        if (i === -1) i = len;
      } else if (next === '*') {
        const end = code.indexOf('*/', i + 2);
        if (end === -1) break;
        i = end + 2;
      } else {
        i++;
      }
    } else {
      i++;
    }
  }

  return ranges;
}

/**
 * Check if a position falls within any of the given ranges.
 */
function isInRange(ranges: Array<[number, number]>, pos: number): boolean {
  for (const [start, end] of ranges) {
    if (pos >= start && pos <= end) return true;
    if (start > pos) break;
  }
  return false;
}

export function transformCossackClass(
  code: string,
  id: string,
  isClientSafeMethod: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>,
  devWarning: boolean
): string {
  // Build string ranges to skip false matches inside template literals
  const stringRanges = buildStringRanges(code);

  // Find class definitions extending Cossack or CossackElement
  const classRegex =
    /(?:export\s+(?:default\s+)?)?class\s+(\w+)\s+(?:extends\s+(?:Cossack(?:<[^>]+>)?|CossackElement))\s*\{/g;

  let match;
  let result = code;
  let replacements: Array<{ start: number; end: number; replacement: string }> = [];

  while ((match = classRegex.exec(code)) !== null) {
    const className = match[1];
    const classStart = match.index;
    const classEnd = match.index + match[0].length;

    // Skip matches that are inside strings or template literals
    if (isInRange(stringRanges, classStart)) {
      continue;
    }

    // Find the matching closing brace for the class
    const classBody = extractClassBody(code, classEnd);
    if (!classBody) {
      console.warn(`[Cossack Security] Could not extract class body for ${className} in ${id}`);
      continue;
    }

    const { body: classBodyText, bodyEnd, closingBrace } = classBody;

    // Transform method definitions using depth tracking
    const transformedBody = transformMethodsWithDepthTracking(
      code,
      classEnd,
      classEnd + classBodyText.length,
      className,
      id,
      isClientSafeMethod,
      builtinMethods,
      devWarning
    );

    // Collect server-only method names that were stubbed
    const serverOnlyMethods = extractServerOnlyMethodNames(
      code,
      classEnd,
      classEnd + classBodyText.length,
      isClientSafeMethod,
      builtinMethods
    );

    let finalBody = transformedBody;

    // Inject metadata registration at the end of the class for server-only methods
    if (serverOnlyMethods.length > 0) {
      const metadataInjection = createMetadataInjection(serverOnlyMethods);
      finalBody = transformedBody + metadataInjection;
    }

    if (finalBody !== classBodyText) {
      replacements.push({
        start: classEnd,
        end: closingBrace,
        replacement: finalBody,
      });
    }
  }

  // Apply replacements in reverse order to maintain positions
  if (replacements.length === 0) return code;

  for (const replacement of [...replacements].reverse()) {
    result =
      result.slice(0, replacement.start) +
      replacement.replacement +
      result.slice(replacement.end);
  }

  return result;
}

/**
 * Extract the names of server-only methods that will be stubbed.
 */
function extractServerOnlyMethodNames(
  fullCode: string,
  classBodyStart: number,
  classBodyEnd: number,
  isClientSafeMethod: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>
): string[] {
  const serverOnlyMethods: string[] = [];
  const classBody = fullCode.slice(classBodyStart, classBodyEnd);

  let i = 0;
  const len = classBody.length;
  let braceDepth = 0;
  let pendingDecorators: string[] = [];

  while (i < len) {
    const char = classBody[i];

    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEndInString(classBody, i, char);
      if (stringEnd === -1) break;
      i = stringEnd + 1;
      continue;
    }

    if (char === '/' && i + 1 < len) {
      const next = classBody[i + 1];
      if (next === '/') {
        i = classBody.indexOf('\n', i + 2);
        if (i === -1) i = len;
        continue;
      } else if (next === '*') {
        i = classBody.indexOf('*/', i + 2);
        if (i === -1) break;
        i += 2;
        continue;
      }
    }

    if (braceDepth === 0 && char === '@') {
      const decoratorEnd = findDecoratorEnd(classBody, i);
      if (decoratorEnd > i) {
        const decorator = classBody.slice(i, decoratorEnd);
        pendingDecorators.push(decorator);
        i = decoratorEnd;
        while (i < len && classBody[i] !== '\n') i++;
        continue;
      }
    }

    if (char === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (char === '}') {
      braceDepth--;
      if (braceDepth < 0) break;
      if (braceDepth === 0) pendingDecorators = [];
      i++;
      continue;
    }

    if (braceDepth === 0 && /[a-zA-Z_$]/.test(char)) {
      const methodMatch = findMethodDefinition(classBody, i);
      if (methodMatch) {
        const { methodName, bodyEnd } = methodMatch;

        if (methodName !== 'constructor' && !isClientSafeMethod(pendingDecorators, methodName, builtinMethods)) {
          serverOnlyMethods.push(methodName);
        }

        pendingDecorators = [];
        i = bodyEnd;
        continue;
      }
    }

    i++;
  }

  return serverOnlyMethods;
}

/**
 * Create metadata injection code that registers server-only methods.
 * This is injected at the end of the class body.
 */
function createMetadataInjection(methodNames: string[]): string {
  const methodList = JSON.stringify(methodNames);
  return `
    // Register server-only methods for RPC proxying
    static __registerServerOnlyMethods() {
      if (typeof Reflect === 'undefined' || !Reflect.hasMetadata) return;
      const serverMethods = Reflect.getOwnMetadata('cossack:server-methods', this) || {};
      const methods = ${methodList};
      for (const name of methods) {
        if (!serverMethods[name]) {
          serverMethods[name] = { channel: 'global', provider: 'page', __serverOnly: true };
        }
      }
      Reflect.defineMetadata('cossack:server-methods', serverMethods, this);
    }
    constructor() {
      super();
      (this.constructor as any).__registerServerOnlyMethods?.();
    }
  `;
}

/**
 * Transform methods using brace depth tracking to ensure only top-level methods are processed.
 * This prevents false matches inside method bodies, template literals, and nested blocks.
 */
function transformMethodsWithDepthTracking(
  fullCode: string,
  classBodyStart: number,
  classBodyEnd: number,
  className: string,
  id: string,
  isClientSafeMethod: (decorators: string[], methodName: string, builtinMethods: Set<string>) => boolean,
  builtinMethods: Set<string>,
  devWarning: boolean
): string {
  const replacements: Array<{ start: number; end: number; replacement: string }> = [];
  const classBody = fullCode.slice(classBodyStart, classBodyEnd);

  let i = 0;
  const len = classBody.length;
  let braceDepth = 0; // Depth of braces inside the class body (0 = at class level)
  let parenDepth = 0; // Depth of parentheses (for detecting method signatures)

  // Track accumulated decorators before a method
  let pendingDecorators: string[] = [];

  while (i < len) {
    const char = classBody[i];

    // Skip strings and template literals
    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEndInString(classBody, i, char);
      if (stringEnd === -1) break;
      i = stringEnd + 1;
      continue;
    }

    // Skip comments
    if (char === '/' && i + 1 < len) {
      const next = classBody[i + 1];
      if (next === '/') {
        i = classBody.indexOf('\n', i + 2);
        if (i === -1) i = len;
        continue;
      } else if (next === '*') {
        i = classBody.indexOf('*/', i + 2);
        if (i === -1) break;
        i += 2;
        continue;
      }
    }

    // Track decorators at class level (braceDepth === 0)
    if (braceDepth === 0 && char === '@') {
      const decoratorEnd = findDecoratorEnd(classBody, i);
      if (decoratorEnd > i) {
        const decorator = classBody.slice(i, decoratorEnd);
        pendingDecorators.push(decorator);
        i = decoratorEnd;
        // Skip to next line
        while (i < len && classBody[i] !== '\n') i++;
        continue;
      }
    }

    // Track braces - only class-level methods are at braceDepth === 0
    if (char === '{') {
      braceDepth++;
      i++;
      continue;
    }
    if (char === '}') {
      braceDepth--;
      if (braceDepth < 0) {
        // End of class body
        break;
      }
      // If we're back to class level, clear pending decorators
      if (braceDepth === 0) {
        pendingDecorators = [];
      }
      i++;
      continue;
    }

    // Only process potential method definitions at class level (braceDepth === 0)
    if (braceDepth === 0) {
      // Look for method pattern: async? methodName(...) or methodName(...)
      // We need to find the opening paren and then the opening brace
      if (/[a-zA-Z_$]/.test(char)) {
        // Potential method start - scan ahead to find the pattern
        const methodMatch = findMethodDefinition(classBody, i);
        if (methodMatch) {
          const { nameStart, nameEnd, methodName, paramsStart, paramsEnd, bodyStart, bodyEnd } = methodMatch;

          // Skip constructor
          if (methodName === 'constructor') {
            pendingDecorators = [];
            i = bodyEnd;
            continue;
          }

          // Skip getters/setters (property accessors)
          if (methodName === 'get' || methodName === 'set') {
            pendingDecorators = [];
            i = bodyEnd;
            continue;
          }

          // Check if this method is client-safe
          if (isClientSafeMethod(pendingDecorators, methodName, builtinMethods)) {
            pendingDecorators = [];
            i = bodyEnd;
            continue;
          }

          // This is a server-only method - stub it
          const stub = createStub(methodName, className, devWarning);

          replacements.push({
            start: bodyStart + 1, // After the opening brace
            end: bodyEnd - 1, // Before the closing brace
            replacement: stub.slice(1, -1), // Remove outer braces from stub
          });

          pendingDecorators = [];
          i = bodyEnd;
          continue;
        }
      }
    }

    i++;
  }

  // Apply replacements in reverse order to maintain positions
  if (replacements.length === 0) return classBody;

  let result = classBody;
  for (const replacement of [...replacements].reverse()) {
    result =
      result.slice(0, replacement.start) +
      replacement.replacement +
      result.slice(replacement.end);
  }

  return result;
}

/**
 * Find a method definition starting at the given position.
 * Returns null if not a method definition.
 */
function findMethodDefinition(
  code: string,
  startPos: number
): { nameStart: number; nameEnd: number; methodName: string; paramsStart: number; paramsEnd: number; bodyStart: number; bodyEnd: number } | null {
  let i = startPos;
  const len = code.length;

  // Skip leading whitespace
  while (i < len && /\s/.test(code[i])) i++;
  if (i >= len) return null;

  // Check for get/set at the current position - these are property accessors, not methods
  // Note: We check the first 4 characters which includes the space after get/set
  const next4 = code.slice(i, i + 4);
  const isGet = code[i] === 'g' && next4 === 'get ';
  const isSet = code[i] === 's' && next4 === 'set ';
  const isGetOrSet = isGet || isSet;
  if (isGetOrSet) {
    // Property accessors should not be stubbed
    // For getters/setters, we need to return the full definition so the main loop skips it
    // We'll use 'get' or 'set' as the method name and let the main loop skip it
    const accessorType = code.slice(i, i + 3); // 'get' or 'set'
    i += 3; // Skip 'get' or 'set'
    while (i < len && /\s/.test(code[i])) i++; // Skip whitespace after get/set

    // Find the property name (identifier)
    const propNameMatch = code.slice(i).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (!propNameMatch) return null;
    const propName = propNameMatch[1];
    i += propName.length;

    // Skip whitespace
    while (i < len && /\s/.test(code[i])) i++;

    // Skip parameter list for getters/setters
    // For getters: `get value()` - we need to skip the `()`
    // For setters: `set value(v)` - we need to skip the `(v)`
    if (i < len && code[i] === '(') {
      let parenDepth = 1;
      i++;
      while (i < len && parenDepth > 0) {
        if (code[i] === '(') parenDepth++;
        else if (code[i] === ')') parenDepth--;
        else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
          const stringEnd = findStringEndInString(code, i, code[i]);
          if (stringEnd === -1) return null;
          i = stringEnd;
        }
        i++;
      }
    }

    // Skip whitespace
    while (i < len && /\s/.test(code[i])) i++;

    // Skip optional type annotation (for getters)
    if (i < len && code[i] === ':') {
      i++;
      while (i < len && code[i] !== '{') {
        if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
          const stringEnd = findStringEndInString(code, i, code[i]);
          if (stringEnd === -1) return null;
          i = stringEnd + 1;
        } else if (code[i] === '(') {
          // Handle parentheses in type annotations (e.g., function types)
          let depth = 1;
          i++;
          while (i < len && depth > 0) {
            if (code[i] === '(') depth++;
            else if (code[i] === ')') depth--;
            i++;
          }
        } else {
          i++;
        }
      }
    }

    // Skip whitespace
    while (i < len && /\s/.test(code[i])) i++;

    // Find opening brace
    if (i >= len || code[i] !== '{') return null;
    const bodyStart = i;

    // Find closing brace (matching braces)
    let braceDepth = 1;
    i++;
    while (i < len && braceDepth > 0) {
      if (code[i] === '{') braceDepth++;
      else if (code[i] === '}') braceDepth--;
      else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const stringEnd = findStringEndInString(code, i, code[i]);
        if (stringEnd === -1) return null;
        i = stringEnd;
      }
      i++;
    }
    const bodyEnd = i;

    // Return as if it's a method with a special marker
    return {
      nameStart: startPos,
      nameEnd: startPos + 3,
      methodName: accessorType, // 'get' or 'set' - will be checked in main loop
      paramsStart: bodyStart,
      paramsEnd: bodyStart,
      bodyStart,
      bodyEnd
    };
  }

  // Skip optional access modifiers and async keyword
  const accessModifiers = ['public', 'private', 'protected', 'static', 'readonly'];
  while (i < len) {
    const remaining = code.slice(i);
    let found = false;
    for (const mod of accessModifiers) {
      if (remaining.startsWith(mod + ' ') || remaining.startsWith(mod + '\t')) {
        i += mod.length;
        while (i < len && /\s/.test(code[i])) i++;
        found = true;
        break;
      }
    }
    if (remaining.startsWith('async ') || remaining.startsWith('async\t') || remaining.startsWith('async\n')) {
      i += 5;
      while (i < len && /\s/.test(code[i])) i++;
      found = true;
    } else if (!found) {
      break;
    }
  }

  // Skip whitespace
  while (i < len && /\s/.test(code[i])) i++;
  if (i >= len) return null;

  // Check for get/set after access modifiers
  if ((code[i] === 'g' && code.slice(i, i + 4) === 'get ' && (i + 3 >= len || /\s/.test(code[i + 3]))) ||
      (code[i] === 's' && code.slice(i, i + 4) === 'set ' && (i + 3 >= len || /\s/.test(code[i + 3])))) {
    // Property accessors should not be stubbed
    return null;
  }

  // Find method name (identifier)
  const nameMatch = code.slice(i).match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
  if (!nameMatch) return null;

  const methodName = nameMatch[1];
  const nameStart = i;
  const nameEnd = i + methodName.length;
  i = nameEnd;

  // Skip optional generics <...>
  if (i < len && code[i] === '<') {
    let depth = 1;
    i++;
    while (i < len && depth > 0) {
      if (code[i] === '<') depth++;
      else if (code[i] === '>') depth--;
      else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const stringEnd = findStringEndInString(code, i, code[i]);
        if (stringEnd === -1) return null;
        i = stringEnd;
      }
      i++;
    }
  }

  // Skip whitespace
  while (i < len && /\s/.test(code[i])) i++;

  // Find opening paren of parameter list
  if (i >= len || code[i] !== '(') return null;
  const paramsStart = i;
  i++;

  // Find closing paren (handling nested parens)
  let parenDepth = 1;
  while (i < len && parenDepth > 0) {
    if (code[i] === '(') parenDepth++;
    else if (code[i] === ')') parenDepth--;
    else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const stringEnd = findStringEndInString(code, i, code[i]);
      if (stringEnd === -1) return null;
      i = stringEnd;
    }
    i++;
  }
  const paramsEnd = i;

  // Skip optional return type annotation
  if (i < len && code[i] === ':') {
    i++;
    while (i < len && code[i] !== '{') {
      if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const stringEnd = findStringEndInString(code, i, code[i]);
        if (stringEnd === -1) return null;
        i = stringEnd + 1;
      } else if (code[i] === '{') {
        break;
      }
      i++;
    }
  }

  // Skip whitespace
  while (i < len && /\s/.test(code[i])) i++;

  // Find opening brace
  if (i >= len || code[i] !== '{') return null;
  const bodyStart = i;

  // Find closing brace (matching braces)
  let braceDepth = 1;
  i++;
  while (i < len && braceDepth > 0) {
    if (code[i] === '{') braceDepth++;
    else if (code[i] === '}') braceDepth--;
    else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      const stringEnd = findStringEndInString(code, i, code[i]);
      if (stringEnd === -1) return null;
      i = stringEnd;
    }
    i++;
  }
  const bodyEnd = i;

  return { nameStart, nameEnd, methodName, paramsStart, paramsEnd, bodyStart, bodyEnd };
}

/**
 * Find the end of a decorator (e.g., @Server(), @Client, @Optimistic('action'))
 */
function findDecoratorEnd(code: string, startPos: number): number {
  let i = startPos + 1; // Skip @
  const len = code.length;

  // Find identifier
  while (i < len && /[a-zA-Z0-9_]/.test(code[i])) i++;

  // Skip whitespace
  while (i < len && /\s/.test(code[i])) i++;

  // Check for parenthesized arguments
  if (i < len && code[i] === '(') {
    let depth = 1;
    i++;
    while (i < len && depth > 0) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
      else if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
        const stringEnd = findStringEndInString(code, i, code[i]);
        if (stringEnd === -1) return -1;
        i = stringEnd;
      }
      i++;
    }
  }

  return i;
}

/**
 * Extract the class body content including the closing brace position.
 */
function extractClassBody(
  code: string,
  startPos: number
): { body: string; bodyEnd: number; closingBrace: number } | null {
  let depth = 1; // We start after the opening '{'
  let i = startPos;
  const len = code.length;

  while (i < len && depth > 0) {
    const char = code[i];

    // Skip strings and template literals
    if (char === '"' || char === "'" || char === '`') {
      const stringEnd = findStringEnd(code, i, char);
      if (stringEnd === -1) return null; // Unclosed string
      i = stringEnd;
      i++;
      continue;
    }

    // Skip comments
    if (char === '/' && i + 1 < len) {
      const next = code[i + 1];
      if (next === '/') {
        // Single-line comment
        i = code.indexOf('\n', i + 2);
        if (i === -1) i = len;
        continue;
      } else if (next === '*') {
        // Multi-line comment
        i = code.indexOf('*/', i + 2);
        if (i === -1) return null; // Unclosed comment
        i += 2;
        continue;
      }
    }

    if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0) {
        return {
          body: code.slice(startPos, i),
          bodyEnd: i,
          closingBrace: i,
        };
      }
    }
    i++;
  }

  return null;
}

/**
 * Find the end of a string literal starting at position pos.
 * For template literals (backticks), handles ${...} expressions recursively.
 */
function findStringEnd(code: string, pos: number, quote: string): number {
  let i = pos + 1;
  const len = code.length;

  while (i < len) {
    const char = code[i];
    if (char === '\\') {
      // Skip escaped character
      i += 2;
      continue;
    }
    if (quote === '`' && char === '$' && i + 1 < len && code[i + 1] === '{') {
      // Template literal expression ${...}
      i += 2; // Skip ${
      let exprDepth = 1;
      while (i < len && exprDepth > 0) {
        const exprChar = code[i];
        if (exprChar === '{') {
          exprDepth++;
          i++;
        } else if (exprChar === '}') {
          exprDepth--;
          if (exprDepth === 0) break;
          i++;
        } else if (exprChar === '"' || exprChar === "'" || exprChar === '`') {
          // Nested string/template literal inside expression
          const nestedEnd = findStringEnd(code, i, exprChar);
          if (nestedEnd === -1) return -1;
          i = nestedEnd + 1;
        } else if (exprChar === '/' && i + 1 < len) {
          // Skip comments inside expressions
          const next = code[i + 1];
          if (next === '/') {
            i = code.indexOf('\n', i + 2);
            if (i === -1) i = len;
          } else if (next === '*') {
            i = code.indexOf('*/', i + 2);
            if (i === -1) return -1;
            i += 2;
          } else {
            i++;
          }
        } else {
          i++;
        }
      }
      continue;
    }
    if (char === quote) {
      return i;
    }
    i++;
  }

  return -1; // Unclosed string
}

/**
 * Find the end of a string literal in a substring (for use with classBody).
 * For template literals (backticks), handles ${...} expressions recursively.
 */
function findStringEndInString(code: string, pos: number, quote: string): number {
  let i = pos + 1;
  const len = code.length;

  while (i < len) {
    const char = code[i];
    if (char === '\\') {
      // Skip escaped character
      i += 2;
      continue;
    }
    if (quote === '`' && char === '$' && i + 1 < len && code[i + 1] === '{') {
      // Template literal expression ${...}
      i += 2; // Skip ${
      let exprDepth = 1;
      while (i < len && exprDepth > 0) {
        const exprChar = code[i];
        if (exprChar === '{') {
          exprDepth++;
          i++;
        } else if (exprChar === '}') {
          exprDepth--;
          if (exprDepth === 0) break;
          i++;
        } else if (exprChar === '"' || exprChar === "'" || exprChar === '`') {
          // Nested string/template literal inside expression
          const nestedEnd = findStringEndInString(code, i, exprChar);
          if (nestedEnd === -1) return -1;
          i = nestedEnd + 1;
        } else {
          i++;
        }
      }
      continue;
    }
    if (char === quote) {
      return i;
    }
    i++;
  }

  return -1; // Unclosed string
}

/**
 * Create a stub function for a server-only method.
 *
 * The stub checks if a runtime proxy exists and calls it.
 * This allows client methods to seamlessly call server-only methods via RPC.
 */
function createStub(
  methodName: string,
  className: string,
  devWarning: boolean
): string {
  if (devWarning) {
    return `{
      // Check if a proxy has been set up for this server-only method
      const proxy = this.__cossack_proxies?.get('${methodName}');
      if (proxy) {
        return proxy.apply(this, arguments);
      }
      // No proxy yet - throw an error
      throw new Error(
        '[Cossack] Method ' + '${className}.${methodName}' + ' is server-only. ' +
        'The proxy has not been set up yet. Make sure this method is called after bootstrap.'
      );
    }`;
  }
  // Production: minimal stub that still checks for proxy
  return `{
    const proxy = this.__cossack_proxies?.get('${methodName}');
    if (proxy) return proxy.apply(this, arguments);
    throw new Error('[Cossack] Method ${className}.${methodName} is server-only.');
  }`;
}

/**
 * Check if a method is decorated with a client-safe decorator.
 * Exported for testing purposes.
 */
export function isClientSafeMethod(
  decorators: string[],
  methodName: string,
  builtinMethods: Set<string>
): boolean {
  // Check for client-safe decorators
  const hasClientDecorator = decorators.some((d) =>
    /@(?:Client|Optimistic|Computed|Shared|OnEvent|PreventNavigation|Validate)\b/.test(d)
  );
  if (hasClientDecorator) return true;

  // Check for built-in methods
  if (builtinMethods.has(methodName)) return true;

  // Check for @Server decorator explicitly - these should be stubbed
  if (decorators.some((d) => /@Server\b/.test(d))) {
    return false;
  }

  // Default: methods without decorators are considered server-only (secure by default)
  return false;
}

export default cossackSecurityPlugin;
