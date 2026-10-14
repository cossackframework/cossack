/**
 * The single HTML tokenizer in the renderer.
 *
 * SSR (`renderToString`) and the client (`compileTemplate`) must agree on what
 * every binding in a template is: child content, part of an attribute, text in
 * a raw-text element, or something inside a comment. They used to run four
 * hand-written scanners that disagreed on `<` in text, comments and raw-text
 * elements. One state machine (`step`) now reads HTML the way the HTML
 * tokenizer does. `analyzeTemplate` drives it over template strings to
 * classify bindings; `tokenizeHtml` drives it over rendered markup for the SSR
 * class merge and `minifyHtml`.
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
  /**
   * Where the binding's element starts: the `<` is at `tagOffset` in the
   * (scoped) string `tagString`. SSR uses it to find the element's markup.
   */
  tagString: number;
  tagOffset: number;
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

// --- The tokenizer ---

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

interface Tokenizer {
  state: State;
  /** Lowercase name of the most recent start tag. Kept after the tag ends. */
  tagName: string;
  /** Lowercase name of the raw-text element whose text is being read. */
  rawTextTag: string;
  quote: '"' | "'";
  /**
   * The last two characters seen inside a comment, seeded with the opening
   * dashes so `<!-->` and `<!--->` close the way the HTML tokenizer does.
   */
  commentTail: string;
}

const createTokenizer = (): Tokenizer => ({ state: State.Data, tagName: '', rawTextTag: '', quote: '"', commentTail: '' });

// A start tag ended: raw-text elements switch to raw text.
const endStartTag = (t: Tokenizer): void => {
  if (RAW_TEXT_TAGS.has(t.tagName)) {
    t.state = State.RawText;
    t.rawTextTag = t.tagName;
  } else {
    t.state = State.Data;
  }
};

// End of a run of characters that cannot change the state: up to the next
// `stop` character, or the end of the string.
const runEnd = (str: string, j: number, stop: string): number => {
  const end = str.indexOf(stop, j);
  return end < 0 ? str.length : end;
};

// End of a tag or attribute name, or of an unquoted value: the next HTML
// whitespace, `/` or `>` (and `=` for attribute names).
const nameEnd = (str: string, j: number, stopAtEquals: boolean): number => {
  for (; j < str.length; j++) {
    const code = str.charCodeAt(j);
    // space, \t, \n, \f, \r, `/`, `>`, `=`
    if (code === 32 || code === 9 || code === 10 || code === 12 || code === 13 || code === 47 || code === 62 ||
      (code === 61 && stopAtEquals)) break;
  }
  return j;
};

/**
 * Advance the tokenizer over `str[j]`. Returns the index of the next character
 * to read: `j + 1`, `j + 4` after `<!--`, the end of a run of characters that
 * cannot change the state (text, raw text, quoted values, comment bodies), or
 * `j` when the character must be read again in the new state (it ended a tag
 * name, an attribute name or an unquoted value). Callers compare the state
 * before and after a step to see what the characters did.
 */
const step = (t: Tokenizer, str: string, j: number): number => {
  const ch = str[j];
  switch (t.state) {
    case State.Data: {
      if (ch !== '<') return runEnd(str, j, '<');
      const next = str[j + 1];
      if (isAsciiAlpha(next)) {
        t.state = State.TagName;
        t.tagName = '';
      } else if (next === '/' && isAsciiAlpha(str[j + 2])) {
        t.state = State.EndTag;
      } else if (next === '!' && str[j + 2] === '-' && str[j + 3] === '-') {
        t.state = State.Comment;
        t.commentTail = '--';
        return j + 4;
      } else if (next === '!' || next === '?' || (next === '/' && str[j + 2] !== undefined)) {
        // `<!doctype>`, `<?x>` and `</ ...>` are bogus comments up to `>`.
        t.state = State.BogusComment;
      }
      return j + 1;
    }
    case State.TagName: {
      const end = nameEnd(str, j, false);
      if (end === j) {
        t.state = State.BeforeAttrName;
        return j;
      }
      t.tagName += str.slice(j, end).toLowerCase();
      return end;
    }
    case State.BeforeAttrName:
    case State.AfterAttrName:
      if (ch === '>') endStartTag(t);
      else if (ch === '/') t.state = State.BeforeAttrName;
      else if (ch === '=' && t.state === State.AfterAttrName) t.state = State.BeforeAttrValue;
      else if (!isSpace(ch)) t.state = State.AttrName;
      return j + 1;
    case State.AttrName:
      if (isSpace(ch)) {
        t.state = State.AfterAttrName;
      } else if (ch === '/' || ch === '>') {
        t.state = State.BeforeAttrName;
        return j;
      } else if (ch === '=') {
        t.state = State.BeforeAttrValue;
      } else {
        return nameEnd(str, j, true);
      }
      return j + 1;
    case State.BeforeAttrValue:
      if (ch === '"' || ch === "'") {
        t.quote = ch;
        t.state = State.AttrValueQuoted;
      } else if (ch === '>') {
        endStartTag(t);
      } else if (!isSpace(ch)) {
        t.state = State.AttrValueUnquoted;
      }
      return j + 1;
    case State.AttrValueQuoted:
      if (ch !== t.quote) return runEnd(str, j, t.quote);
      t.state = State.BeforeAttrName;
      return j + 1;
    case State.AttrValueUnquoted:
      if (isSpace(ch) || ch === '>') {
        t.state = State.BeforeAttrName;
        return j;
      }
      // `/` is part of an unquoted value.
      return ch === '/' ? j + 1 : nameEnd(str, j, false);
    case State.EndTag:
    case State.BogusComment:
      if (ch !== '>') return runEnd(str, j, '>');
      t.state = State.Data;
      return j + 1;
    case State.Comment: {
      if (ch === '>' && t.commentTail === '--') {
        t.state = State.Data;
        return j + 1;
      }
      const end = Math.max(runEnd(str, j, '>'), j + 1);
      t.commentTail = (t.commentTail + str.slice(Math.max(j, end - 2), end)).slice(-2);
      return end;
    }
    case State.RawText: {
      if (ch !== '<') return runEnd(str, j, '<');
      const tag = t.rawTextTag;
      if (str[j + 1] === '/' && str.slice(j + 2, j + 2 + tag.length).toLowerCase() === tag) {
        const after = str[j + 2 + tag.length];
        if (after === undefined || isSpace(after) || after === '/' || after === '>') t.state = State.EndTag;
      }
      return j + 1;
    }
  }
};

// --- Template analysis ---

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

  const t = createTokenizer();
  let rawTextEmpty = true;
  let valueEmpty = true;
  let attr: OpenAttribute | null = null;
  let spaceStart = -1;
  // Attribute bindings of the tag being read and whether it has a static
  // `value` attribute; resolved into `directValue` when the tag closes.
  let tagBindings: AttributeBinding[] = [];
  let tagHasStaticValue = false;
  let tagString = 0;
  let tagOffset = 0;

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
    // An opening tag's `>` was read.
    const tagEnded = () => {
      closeAttribute(0);
      const directValue = t.tagName !== 'textarea' && t.tagName !== 'select' && !tagHasStaticValue;
      for (const binding of tagBindings) binding.directValue = directValue;
      tagBindings = [];
      if (t.state === State.RawText) rawTextEmpty = true;
    };

    for (let j = 0; j < str.length;) {
      const ch = str[j];
      const from = t.state;
      const next = step(t, str, j);
      const to = t.state;
      // Bookkeeping runs before the character is copied, so `out.length` is
      // the output offset of `ch`.
      switch (from) {
        case State.Data:
          if (to === State.TagName) {
            tagBindings = [];
            tagHasStaticValue = false;
            tagString = i;
            tagOffset = out.length;
          }
          break;
        case State.TagName:
          if (to !== State.TagName) {
            out += scopeAttr;
            spaceStart = -1;
          }
          break;
        case State.BeforeAttrName:
        case State.AfterAttrName:
          if (to === State.AttrName) {
            closeAttribute(j);
            const start = out.length;
            attr = { name: ch, stringIndex: i, nameStart: start, spaceStart: spaceStart < 0 ? start : spaceStart, indices: [], prefix: '' };
            spaceStart = -1;
          } else if (isSpace(ch)) {
            if (spaceStart < 0) spaceStart = out.length;
          } else if (ch === '/') {
            spaceStart = -1;
          } else if (to !== State.BeforeAttrValue) {
            tagEnded();
          }
          break;
        case State.AttrName:
          if (to === State.AttrName) {
            // `attr` is null when a binding interrupted the name (`<a b${x}c>`).
            if (attr) attr.name += str.slice(j, next);
          } else if (to === State.AfterAttrName) {
            spaceStart = out.length;
          } else if (to === State.BeforeAttrName) {
            closeAttribute(j);
            spaceStart = -1;
          }
          break;
        case State.BeforeAttrValue:
          if (to === State.AttrValueQuoted) {
            valueEmpty = true;
          } else if (to === State.Data || to === State.RawText) {
            closeAttribute(j);
            tagEnded();
          }
          break;
        case State.AttrValueQuoted:
          if (to === State.BeforeAttrName) {
            closeAttribute(j + 1);
            spaceStart = -1;
          } else {
            valueEmpty = false;
          }
          break;
        case State.AttrValueUnquoted:
          if (to === State.BeforeAttrName) {
            closeAttribute(j);
            spaceStart = -1;
          }
          break;
        case State.RawText:
          if (to === State.RawText) rawTextEmpty = false;
          break;
      }
      out += str.slice(j, next);
      j = next;
    }

    if (i < input.length - 1) {
      // Classify the binding that follows this string.
      switch (t.state) {
        case State.Data:
          bindings.push({ kind: 'node' });
          break;
        case State.Comment:
        case State.BogusComment:
          bindings.push({ kind: 'comment' });
          break;
        case State.RawText:
          bindings.push({ kind: 'raw-text', tag: t.rawTextTag, first: rawTextEmpty });
          rawTextEmpty = false;
          break;
        case State.BeforeAttrValue:
        case State.AttrValueQuoted:
        case State.AttrValueUnquoted: {
          // The value of an attribute whose name a binding interrupted.
          if (!attr) {
            bindings.push({ kind: 'element' });
            break;
          }
          const open: OpenAttribute = attr;
          const quoted = t.state === State.AttrValueQuoted;
          const start = (t.state === State.BeforeAttrValue || (quoted && valueEmpty)) && open.stringIndex === i;
          if (open.indices.length === 0 && open.stringIndex === i) {
            open.prefix = out.slice(open.spaceStart);
          }
          open.indices.push(i);
          const binding: AttributeBinding = {
            kind: 'attribute',
            name: open.name,
            start,
            quote: quoted ? t.quote : '',
            prefixStart: start ? open.nameStart : -1,
            directValue: false,
            tagString,
            tagOffset,
          };
          bindings.push(binding);
          tagBindings.push(binding);
          // A value binding starts an unquoted value.
          if (t.state === State.BeforeAttrValue) t.state = State.AttrValueUnquoted;
          valueEmpty = false;
          break;
        }
        default:
          bindings.push({ kind: 'element' });
          if (t.state === State.AttrName || t.state === State.AfterAttrName) {
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

// --- Markup tokens ---

/** An attribute of a start tag. Offsets index the tokenized source. */
export interface HtmlAttribute {
  /** As written. */
  readonly name: string;
  readonly nameStart: number;
  readonly nameEnd: number;
  /** Value bounds without quotes; both -1 when there is no `=`. */
  readonly valueStart: number;
  readonly valueEnd: number;
  readonly quote: '"' | "'" | '';
}

/** One token of rendered markup. `start`/`end` index the tokenized source. */
export type HtmlToken =
  | { readonly type: 'text'; readonly start: number; readonly end: number }
  /** Text of a raw-text element (`tag` is lowercase). */
  | { readonly type: 'raw-text'; readonly start: number; readonly end: number; readonly tag: string }
  | {
    readonly type: 'start-tag'; readonly start: number; readonly end: number;
    /** Lowercase tag name; the source keeps the author's case. */
    readonly name: string;
    readonly nameEnd: number;
    readonly attributes: readonly HtmlAttribute[];
    /** The tag ends with `/>`. */
    readonly selfClosing: boolean;
    /** False when the source ends before the tag's `>`. */
    readonly closed: boolean;
  }
  | { readonly type: 'end-tag'; readonly start: number; readonly end: number; readonly name: string; readonly nameEnd: number }
  /** `<!--` up to and including `-->`. */
  | { readonly type: 'comment'; readonly start: number; readonly end: number }
  /** `<!doctype>`, `<?…>`, `</ …>`, or markup the source ends inside. */
  | { readonly type: 'other'; readonly start: number; readonly end: number };

interface MutableAttribute {
  name: string;
  nameStart: number;
  nameEnd: number;
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'" | '';
}

/** Split rendered markup into tokens, using the same tokenizer as templates. */
export const tokenizeHtml = (source: string): HtmlToken[] => {
  const tokens: HtmlToken[] = [];
  forEachHtmlToken(source, (token) => { tokens.push(token); });
  return tokens;
};

/** Call `visit` with each token of rendered markup, in order. */
export const forEachHtmlToken = (source: string, visit: (token: HtmlToken) => void): void => {
  const t = createTokenizer();
  let start = 0;
  let nameEnd = -1;
  let attributes: MutableAttribute[] = [];
  let attr: MutableAttribute | undefined;
  let slash = false;

  const startTag = (end: number, closed: boolean) => {
    if (attr && attr.nameEnd < 0) attr.nameEnd = end;
    if (attr && attr.valueStart >= 0 && attr.valueEnd < 0) attr.valueEnd = end;
    visit({
      type: 'start-tag', start, end, name: t.tagName, nameEnd: nameEnd < 0 ? end : nameEnd,
      attributes, selfClosing: closed && slash, closed,
    });
  };

  for (let j = 0; j < source.length;) {
    const ch = source[j];
    const from = t.state;
    const next = step(t, source, j);
    const to = t.state;
    switch (from) {
      case State.Data:
        if (to !== State.Data) {
          if (j > start) visit({ type: 'text', start, end: j });
          start = j;
          if (to === State.TagName) {
            nameEnd = -1;
            attributes = [];
            attr = undefined;
            slash = false;
          }
        }
        break;
      case State.RawText:
        if (to === State.EndTag) {
          if (j > start) visit({ type: 'raw-text', start, end: j, tag: t.rawTextTag });
          start = j;
        }
        break;
      case State.EndTag:
        if (to === State.Data) {
          let end = start + 2;
          while (end < next && !isSpace(source[end]) && source[end] !== '/' && source[end] !== '>') end++;
          visit({ type: 'end-tag', start, end: next, name: source.slice(start + 2, end).toLowerCase(), nameEnd: end });
          start = next;
        }
        break;
      case State.Comment:
      case State.BogusComment:
        if (to === State.Data) {
          visit({ type: from === State.Comment ? 'comment' : 'other', start, end: next });
          start = next;
        }
        break;
      case State.TagName:
        if (to !== State.TagName) nameEnd = j;
        break;
      case State.BeforeAttrName:
      case State.AfterAttrName:
        if (to === State.AttrName) {
          attr = { name: '', nameStart: j, nameEnd: -1, valueStart: -1, valueEnd: -1, quote: '' };
          attributes.push(attr);
        } else if (to === State.Data || to === State.RawText) {
          startTag(next, true);
          start = next;
        }
        // Only a `/` directly before `>` makes the tag self-closing.
        slash = ch === '/';
        break;
      case State.AttrName:
        if (to !== State.AttrName && attr) {
          attr.nameEnd = j;
          attr.name = source.slice(attr.nameStart, j);
        }
        break;
      case State.BeforeAttrValue:
        if (!attr) break;
        if (to === State.AttrValueQuoted) {
          attr.quote = t.quote;
          attr.valueStart = j + 1;
        } else if (to === State.AttrValueUnquoted) {
          attr.valueStart = j;
        } else if (to === State.Data || to === State.RawText) {
          // `name=>`: an empty value.
          attr.valueStart = attr.valueEnd = j;
          startTag(next, true);
          start = next;
        }
        break;
      case State.AttrValueQuoted:
      case State.AttrValueUnquoted:
        if (to === State.BeforeAttrName && attr) attr.valueEnd = j;
        break;
    }
    j = next;
  }

  if (start < source.length) {
    const end = source.length;
    switch (t.state) {
      case State.Data:
        visit({ type: 'text', start, end });
        break;
      case State.RawText:
        visit({ type: 'raw-text', start, end, tag: t.rawTextTag });
        break;
      case State.TagName:
      case State.BeforeAttrName:
      case State.AttrName:
      case State.AfterAttrName:
      case State.BeforeAttrValue:
      case State.AttrValueQuoted:
      case State.AttrValueUnquoted:
        if (attr && attr.name === '') attr.name = source.slice(attr.nameStart, attr.nameEnd < 0 ? end : attr.nameEnd);
        startTag(end, false);
        break;
      default:
        visit({ type: 'other', start, end });
        break;
    }
  }
};
