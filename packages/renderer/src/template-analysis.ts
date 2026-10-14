/**
 * The single HTML tokenizer behind both renderers.
 *
 * SSR (`renderToString`) and the client (`compileTemplate`) must agree on what
 * every binding in a template is: child content, part of an attribute, text in
 * a raw-text element, or something inside a comment. They used to run four
 * hand-written scanners that disagreed on `<` in text, comments and raw-text
 * elements. This module walks the template strings once, the way the HTML
 * tokenizer would, and records the answer for every binding.
 */

/** Elements whose content the HTML parser reads as text, not markup. */
export const RAW_TEXT_TAGS: ReadonlySet<string> = new Set(['script', 'style', 'textarea', 'title']);

export type BindingInfo =
  /** Child content. Hydration wraps it in `<!--CRP_i-->`/`<!--/CRP-->`. */
  | { kind: 'node' }
  /**
   * Inside an attribute value. `name` keeps the author's case (the DOM
   * lowercases HTML attribute names). `start` bindings directly follow
   * `name=` or `name="`; `prefixStart` is the index in the (scoped) string
   * where that `name=` text begins. Other attribute bindings interpolate into
   * a value that already started.
   *
   * `directValue` is true when a `.value` set here (directly or through a
   * spread) can be serialized by SSR as a plain `value` attribute: the element
   * is not a <textarea>/<select> and has no static `value` attribute. Other
   * cases need the serializeFormValues pass.
   */
  | AttributeBinding
  /**
   * Text content of a raw-text element (`tag` is lowercase). `first` is true
   * when no text precedes the binding inside the element.
   */
  | { kind: 'raw-text'; tag: string; first: boolean }
  /** Inside a comment. The value is dropped by both renderers. */
  | { kind: 'comment' }
  /** In a tag but not in an attribute value (e.g. `<div ${x}>`). Dropped. */
  | { kind: 'element' };

export interface AttributeBinding {
  kind: 'attribute';
  name: string;
  start: boolean;
  quote: '"' | "'" | '';
  prefixStart: number;
  directValue: boolean;
}

/** An attribute that contains bindings, used to drop it whole for `nothing`. */
export interface AttributeGroup {
  readonly indices: readonly number[];
  /** Static text from the whitespace before the name up to the first binding. */
  readonly prefix: string;
  /** Static text after the last binding that still belongs to the attribute. */
  readonly suffixLength: number;
}

/**
 * Everything the renderers need to know about a template's static strings.
 * It never depends on values, so one analysis is shared by every render and
 * every instance of the template. It is deeply frozen: a render that tried to
 * write to it would corrupt every later render, so that throws instead.
 */
export interface TemplateAnalysis {
  /** Template strings with the style scope attribute added to static tags. */
  readonly strings: readonly string[];
  readonly bindings: readonly Readonly<BindingInfo>[];
  /**
   * Indexed by binding: the attribute whose first binding has that index, or
   * undefined. Same length as `bindings`.
   */
  readonly attributeGroups: readonly (AttributeGroup | undefined)[];
}

/** @internal Counts analysis runs so tests can verify the cache. */
export const templateAnalysisStats = { runs: 0 };

// Tagged-template strings arrays are identity-stable per call site, so the
// analysis is computed once per (strings, style scope).
const analyses = new WeakMap<TemplateStringsArray, Map<string, TemplateAnalysis>>();

/** The shared analysis for a template's strings in a style scope. */
export const getTemplateAnalysis = (input: TemplateStringsArray, scopeId?: string): TemplateAnalysis => {
  let byScope = analyses.get(input);
  if (!byScope) {
    byScope = new Map();
    analyses.set(input, byScope);
  }
  const key = scopeId ?? '';
  let analysis = byScope.get(key);
  if (!analysis) {
    analysis = analyzeTemplate(input, scopeId);
    byScope.set(key, analysis);
  }
  return analysis;
};

const enum State {
  Data,
  TagName,
  BeforeAttrName,
  AttrName,
  AfterAttrName,
  BeforeAttrValue,
  AttrValueQuoted,
  AttrValueUnquoted,
  EndTag,
  Comment,
  BogusComment,
  RawText,
}

const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';
const isAsciiAlpha = (ch: string | undefined) => !!ch && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));

interface OpenAttribute {
  name: string;
  /** String index where the attribute name begins. */
  stringIndex: number;
  /** Output offset (in that string) where the name begins. */
  nameStart: number;
  /** Output offset of the whitespace run before the name. */
  spaceStart: number;
  indices: number[];
  prefix: string;
}

/**
 * Tokenize template strings and classify every binding.
 *
 * When `scopeId` is given, ` data-cossack-scope="<id>"` is inserted after the
 * name of every opening tag that appears in the static strings (not inside
 * comments or raw text, and never inside nested values).
 */
export const analyzeTemplate = (input: readonly string[], scopeId?: string): TemplateAnalysis => {
  templateAnalysisStats.runs++;
  const scopeAttr = scopeId ? ` data-cossack-scope="${scopeId}"` : '';
  const strings: string[] = [];
  const bindings: BindingInfo[] = [];
  const attributeGroups = Array.from<AttributeGroup | undefined>({ length: Math.max(input.length - 1, 0) });

  let state = State.Data;
  let tagName = '';
  let rawTextTag = '';
  let rawTextEmpty = true;
  let quote: '"' | "'" = '"';
  let valueEmpty = true;
  // The last two characters seen inside a comment, seeded with the opening
  // dashes so `<!-->` and `<!--->` close the way the HTML tokenizer does.
  let commentTail = '';
  let attr: OpenAttribute | null = null;
  let spaceStart = -1;
  // Attribute bindings of the tag being read and whether it has a static
  // `value` attribute; resolved into `directValue` when the tag closes.
  let tagBindings: AttributeBinding[] = [];
  let tagHasStaticValue = false;

  for (let i = 0; i < input.length; i++) {
    const str = input[i];
    let out = '';

    const closeAttribute = (endInThisString: number) => {
      if (attr && attr.indices.length === 0 && attr.name.toLowerCase() === 'value') tagHasStaticValue = true;
      if (attr && attr.indices.length > 0 && attr.stringIndex === attr.indices[0]) {
        const last = attr.indices[attr.indices.length - 1];
        // The suffix lives at the start of the string after the last binding.
        attributeGroups[attr.indices[0]] = Object.freeze({
          indices: Object.freeze(attr.indices),
          prefix: attr.prefix,
          suffixLength: i === last + 1 ? endInThisString : 0,
        });
      }
      attr = null;
    };
    // The state after an opening tag's `>`: raw text for raw-text elements.
    const afterTag = (): State => {
      closeAttribute(0);
      const directValue = tagName !== 'textarea' && tagName !== 'select' && !tagHasStaticValue;
      for (const binding of tagBindings) binding.directValue = directValue;
      tagBindings = [];
      const next = RAW_TEXT_TAGS.has(tagName) ? State.RawText : State.Data;
      if (next === State.RawText) {
        rawTextTag = tagName;
        rawTextEmpty = true;
      }
      tagName = '';
      return next;
    };

    for (let j = 0; j < str.length; j++) {
      const ch = str[j];
      switch (state) {
        case State.Data:
          out += ch;
          if (ch === '<') {
            const next = str[j + 1];
            if (isAsciiAlpha(next)) {
              state = State.TagName;
              tagName = '';
              tagBindings = [];
              tagHasStaticValue = false;
            } else if (next === '/' && isAsciiAlpha(str[j + 2])) {
              state = State.EndTag;
            } else if (next === '!' && str[j + 2] === '-' && str[j + 3] === '-') {
              out += '!--';
              j += 3;
              state = State.Comment;
              commentTail = '--';
            } else if (next === '!' || next === '?' || (next === '/' && next !== undefined && str[j + 2] !== undefined)) {
              // `<!doctype>`, `<?x>` and `</ ...>` are bogus comments up to `>`.
              state = State.BogusComment;
            }
          }
          break;
        case State.TagName:
          if (isSpace(ch) || ch === '/' || ch === '>') {
            out += scopeAttr;
            state = State.BeforeAttrName;
            spaceStart = -1;
            j--; // reprocess as attribute-area character
          } else {
            tagName += ch.toLowerCase();
            out += ch;
          }
          break;
        case State.BeforeAttrName:
        case State.AfterAttrName:
          if (isSpace(ch)) {
            if (spaceStart < 0) spaceStart = out.length;
            out += ch;
          } else if (ch === '>') {
            out += ch;
            state = afterTag();
          } else if (ch === '/') {
            out += ch;
            spaceStart = -1;
            state = State.BeforeAttrName;
          } else if (ch === '=' && state === State.AfterAttrName && attr) {
            out += ch;
            state = State.BeforeAttrValue;
          } else {
            closeAttribute(j);
            const start = out.length;
            attr = { name: ch, stringIndex: i, nameStart: start, spaceStart: spaceStart < 0 ? start : spaceStart, indices: [], prefix: '' };
            out += ch;
            spaceStart = -1;
            state = State.AttrName;
          }
          break;
        case State.AttrName:
          if (isSpace(ch)) {
            spaceStart = out.length;
            out += ch;
            state = State.AfterAttrName;
          } else if (ch === '/' || ch === '>') {
            closeAttribute(j);
            state = State.BeforeAttrName;
            spaceStart = -1;
            j--;
          } else if (ch === '=') {
            out += ch;
            state = State.BeforeAttrValue;
          } else {
            attr!.name += ch;
            out += ch;
          }
          break;
        case State.BeforeAttrValue:
          if (isSpace(ch)) {
            out += ch;
          } else if (ch === '"' || ch === "'") {
            out += ch;
            quote = ch;
            valueEmpty = true;
            state = State.AttrValueQuoted;
          } else if (ch === '>') {
            closeAttribute(j);
            out += ch;
            state = afterTag();
          } else {
            out += ch;
            state = State.AttrValueUnquoted;
          }
          break;
        case State.AttrValueQuoted:
          out += ch;
          if (ch === quote) {
            closeAttribute(j + 1);
            spaceStart = -1;
            state = State.BeforeAttrName;
          } else {
            valueEmpty = false;
          }
          break;
        case State.AttrValueUnquoted:
          if (isSpace(ch) || ch === '>') {
            closeAttribute(j);
            spaceStart = -1;
            state = State.BeforeAttrName;
            j--;
          } else {
            out += ch;
          }
          break;
        case State.EndTag:
          out += ch;
          if (ch === '>') state = State.Data;
          break;
        case State.Comment:
          out += ch;
          if (ch === '>' && commentTail === '--') state = State.Data;
          else commentTail = (commentTail + ch).slice(-2);
          break;
        case State.BogusComment:
          out += ch;
          if (ch === '>') state = State.Data;
          break;
        case State.RawText: {
          if (ch === '<' && str[j + 1] === '/' &&
            str.slice(j + 2, j + 2 + rawTextTag.length).toLowerCase() === rawTextTag) {
            const after = str[j + 2 + rawTextTag.length];
            if (after === undefined || isSpace(after) || after === '/' || after === '>') {
              out += ch;
              state = State.EndTag;
              break;
            }
          }
          out += ch;
          rawTextEmpty = false;
          break;
        }
      }
    }

    if (i < input.length - 1) {
      // Classify the binding that follows this string.
      switch (state) {
        case State.Data:
          bindings.push({ kind: 'node' });
          break;
        case State.Comment:
        case State.BogusComment:
          bindings.push({ kind: 'comment' });
          break;
        case State.RawText:
          bindings.push({ kind: 'raw-text', tag: rawTextTag, first: rawTextEmpty });
          rawTextEmpty = false;
          break;
        case State.BeforeAttrValue:
        case State.AttrValueQuoted:
        case State.AttrValueUnquoted: {
          const open = attr!;
          const quoted = state === State.AttrValueQuoted;
          const start = (state === State.BeforeAttrValue || (quoted && valueEmpty)) && open.stringIndex === i;
          if (open.indices.length === 0 && open.stringIndex === i) {
            open.prefix = out.slice(open.spaceStart);
          }
          open.indices.push(i);
          const binding: AttributeBinding = {
            kind: 'attribute',
            name: open.name,
            start,
            quote: quoted ? quote : '',
            prefixStart: start ? open.nameStart : -1,
            directValue: false,
          };
          bindings.push(binding);
          tagBindings.push(binding);
          if (state === State.BeforeAttrValue) state = State.AttrValueUnquoted;
          valueEmpty = false;
          break;
        }
        default:
          bindings.push({ kind: 'element' });
          if (state === State.AttrName || state === State.AfterAttrName) {
            // `<div foo${x}>`: the binding interrupts an attribute name.
            closeAttribute(0);
          }
          break;
      }
    }
    strings.push(out);
  }

  // `directValue` is resolved when each tag closes, so freeze only now.
  for (const binding of bindings) Object.freeze(binding);
  return Object.freeze({
    strings: Object.freeze(strings),
    bindings: Object.freeze(bindings),
    attributeGroups: Object.freeze(attributeGroups),
  });
};
