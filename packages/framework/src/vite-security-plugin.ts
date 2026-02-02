import type { Plugin } from 'vite';

export interface CossackSecurityPluginOptions {
  mode?: 'client' | 'ssr';
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
 */
export function cossackSecurityPlugin(options: CossackSecurityPluginOptions = {}): Plugin {
  const {
    mode = 'client',
    devWarning = true,
  } = options;

  // Only apply security in client mode
  if (mode !== 'client') {
    return {
      name: 'cossack-security',
      enforce: 'pre',
      transform(code, id) {
        // In SSR mode, pass through without changes
        return { code, map: null };
      },
    };
  }

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
  ]);

  /**
   * Check if a method is decorated with a client-safe decorator.
   */
  function isClientSafeMethod(
    decorators: string[],
    methodName: string
  ): boolean {
    // Check for client-safe decorators
    const hasClientDecorator = decorators.some((d) =>
      /@(?:Client|Optimistic|Computed|Shared)\b/.test(d)
    );
    if (hasClientDecorator) return true;

    // Check for built-in methods
    if (BUILTIN_METHODS.has(methodName)) return true;

    // Check for @Server decorator explicitly - these should be stubbed
    if (decorators.some((d) => /@Server\b/.test(d))) {
      return false;
    }

    // Default: methods without decorators are considered server-only (secure by default)
    return false;
  }

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
      if (!shouldProcessFile(id)) {
        return { code, map: null };
      }

      // Check if this file contains a Cossack class
      if (!code.includes('extends Cossack') && !code.includes('extends CossackElement')) {
        return { code, map: null };
      }

      try {
        const transformed = transformCossackClass(code, id, isClientSafeMethod, devWarning);
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
function transformCossackClass(
  code: string,
  id: string,
  isClientSafeMethod: (decorators: string[], methodName: string) => boolean,
  devWarning: boolean
): string {
  // Find class definitions extending Cossack or CossackElement
  const classRegex =
    /(?:export\s+(?:default\s+)?)?class\s+(\w+)\s+(?:extends\s+(?:Cossack(?:<[^>]+>)?|CossackElement))\s*\{/g;

  let match;
  let result = code;

  while ((match = classRegex.exec(code)) !== null) {
    const className = match[1];
    const classStart = match.index + match[0].length;

    // Find the matching closing brace for the class
    const classBody = extractClassBody(code, classStart);
    if (!classBody) {
      console.warn(`[Cossack Security] Could not extract class body for ${className} in ${id}`);
      continue;
    }

    const { body: classBodyText, bodyEnd } = classBody;

    // Transform method definitions using depth tracking
    const transformedBody = transformMethodsWithDepthTracking(
      code,
      classStart,
      classStart + classBodyText.length,
      className,
      id,
      isClientSafeMethod,
      devWarning
    );

    if (transformedBody !== classBodyText) {
      // Replace the class body in the original code
      result =
        result.slice(0, classStart) +
        transformedBody +
        result.slice(classStart + classBodyText.length);
    }
  }

  return result;
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
  isClientSafeMethod: (decorators: string[], methodName: string) => boolean,
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

          // Check if this method is client-safe
          if (isClientSafeMethod(pendingDecorators, methodName)) {
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
    if (char === quote) {
      return i;
    }
    i++;
  }

  return -1; // Unclosed string
}

/**
 * Find the end of a string literal in a substring (for use with classBody).
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
    if (char === quote) {
      return i;
    }
    i++;
  }

  return -1; // Unclosed string
}

/**
 * Create a stub function for a server-only method.
 */
function createStub(
  methodName: string,
  className: string,
  devWarning: boolean
): string {
  if (devWarning) {
    return `{
      throw new Error(
        '[Cossack] Method ' + '${className}.${methodName}' + ' is server-only and cannot be called directly on the client. ' +
        'Use the proxy method or call it via the server transport.'
      );
    }`;
  }
  return '{}'; // Production: minimal stub
}

export default cossackSecurityPlugin;
