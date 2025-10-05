import { TemplateResult } from '../types';
import { escapeHTML } from './escape';

const isTemplateResult = (value: any): value is TemplateResult => {
  return value && typeof value === 'object' && 'strings' in value && 'values' in value;
}

const attrRegex = /\s*([.?@a-zA-Z0-9-_]+|...)=["']?$/;

export function renderToString(result: TemplateResult): string {
  const { strings, values } = result;
  let html = '';
  let inSkippedAttribute = false;

  for (let i = 0; i < values.length; i++) {
    let stringPart = strings[i];

    if (inSkippedAttribute) {
      if (stringPart.startsWith('"')) {
        stringPart = stringPart.slice(1);
      } else if (stringPart.startsWith("'")) {
        stringPart = stringPart.slice(1);
      }
      inSkippedAttribute = false;
    }
    html += stringPart;

    const value = values[i];
    const attrMatch = stringPart.match(attrRegex);

    if (attrMatch) {
      const rawName = attrMatch[1];

      if (rawName === '...') {
        html = html.slice(0, -attrMatch[0].length);
        html += toHTML(value);
        inSkippedAttribute = true;
        continue;
      }

      const type = rawName.startsWith('@') ? 'event' : rawName.startsWith('.') ? 'property' : rawName.startsWith('?') ? 'boolean' : 'attribute';

      if (type === 'event' || type === 'property') {
        html = html.slice(0, -attrMatch[0].length);
        inSkippedAttribute = true;
        continue;
      }

      if (type === 'boolean') {
        html = html.slice(0, -attrMatch[0].length);
        if (value) {
          html += ` ${rawName.slice(1)}`;
        }
        inSkippedAttribute = true;
        continue;
      }

      if (value == null) {
        html = html.slice(0, -attrMatch[0].length);
        inSkippedAttribute = true;
        continue;
      } else {
        html += escapeHTML(String(value));
      }
    } else {
      html += toHTML(value);
    }
  }

  let lastStringPart = strings[strings.length - 1];
  if (inSkippedAttribute) {
    if (lastStringPart.startsWith('"')) {
      lastStringPart = lastStringPart.slice(1);
    } else if (lastStringPart.startsWith("'")) {
      lastStringPart = lastStringPart.slice(1);
    }
  }
  html += lastStringPart;

  return html;
}

function toHTML(value: unknown): string {
  if (
    typeof value === 'object' &&
    value !== null &&
    !isTemplateResult(value) &&
    !Array.isArray(value)
  ) {
    let attrs = '';
    const props = value as Record<string, unknown>;
    for (const name in props) {
      const propValue = props[name];
      if (name.startsWith('@') || name.startsWith('.')) {
        continue;
      }
      if (name.startsWith('?')) {
        if (propValue) {
          attrs += ` ${name.slice(1)}`;
        }
      } else {
        if (propValue != null) {
          attrs += ` ${name}="${escapeHTML(String(propValue))}"`;
        }
      }
    }
    return attrs ? ' ' + attrs.trim() : '';
  }
  if (isTemplateResult(value)) {
    return renderToString(value);
  } else if (Array.isArray(value)) {
    return value.map(toHTML).join('');
  } else if (value == null) {
    return '';
  }
  return escapeHTML(String(value));
}

export function renderToReadableStream(result: TemplateResult): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const str = renderToString(result);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(str));
      controller.close();
    },
  });
}
