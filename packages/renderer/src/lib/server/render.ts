import { TemplateResult } from '../types';
import { escapeHTML } from './escape';

const attrRegex = /\s*([.?@a-zA-Z0-9-_]+|...)=["']?$/;

export function renderToString(result: TemplateResult): string {
  const { strings, values } = result;
  let html = '';
  let inSkippedAttribute = false;

  // Loop through n-1 string parts and all values
  for (let i = 0; i < values.length; i++) {
    let stringPart = strings[i];

    // If the last part was a skipped attribute, this part starts with a quote we must remove.
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
      // This is an attribute part.
      const rawName = attrMatch[1];

      if (rawName === '...') {
        html = html.slice(0, -attrMatch[0].length); // remove `...="`
        html += toHTML(value); // add the spread attributes
        inSkippedAttribute = true; // skip the closing quote
        continue;
      }

      const type = rawName.startsWith('@')
        ? 'event'
        : rawName.startsWith('.')
          ? 'property'
          : rawName.startsWith('?')
            ? 'boolean'
            : 'attribute';

      if (type === 'event' || type === 'property') {
        // Remove the attribute from the html built so far.
        html = html.slice(0, -attrMatch[0].length);
        // Set flag to skip the value and remove the closing quote from the next string part.
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

      // Regular attribute
      if (value == null) {
        // Remove the attribute name part and skip the value.
        html = html.slice(0, -attrMatch[0].length);
        inSkippedAttribute = true;
        continue;
      } else {
        html += escapeHTML(String(value));
      }
    } else {
      // This is a child part.
      html += toHTML(value);
    }
  }

  // Add the final string part, after handling any leftover skipped attribute state.
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
    !(value instanceof TemplateResult) &&
    !Array.isArray(value)
  ) {
    let attrs = '';
    const props = value as Record<string, unknown>;
    for (const name in props) {
      const propValue = props[name];
      if (name.startsWith('@') || name.startsWith('.')) {
        continue; // Skip events and properties on server
      }
      if (name.startsWith('?')) {
        // boolean
        if (propValue) {
          attrs += ` ${name.slice(1)}`;
        }
      } else {
        // attribute
        if (propValue != null) {
          attrs += ` ${name}="${escapeHTML(String(propValue))}"`;
        }
      }
    }
    // Add a space before the attributes to ensure it's parsed correctly
    return attrs ? ' ' + attrs.trim() : '';
  }
  if (value instanceof TemplateResult) {
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