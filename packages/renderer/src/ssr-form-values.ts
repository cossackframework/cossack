import { parseFragment, type DefaultTreeAdapterTypes as Tree } from 'parse5';

const escapeText = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Convert temporary property attributes without reserializing authored markup or hydration markers. */
export const serializeFormValues = (source: string): string => {
  if (!source.includes(' .value=')) return source;
  const root = parseFragment(source, { sourceCodeLocationInfo: true });
  const edits: { start: number; end: number; text: string }[] = [];
  const textContent = (node: Tree.Node): string => {
    if ('tagName' in node && node.tagName === 'script') return '';
    if (node.nodeName === '#text') return (node as Tree.TextNode).value;
    if ('childNodes' in node) return node.childNodes.map(textContent).join('');
    return '';
  };
  const visit = (node: Tree.Node): void => {
    if ('tagName' in node) {
      const prop = node.attrs.find(attr => attr.name === '.value');
      const location = node.sourceCodeLocation;
      const attrLocation = location?.attrs?.['.value'];
      if (prop && attrLocation) {
        const native = node.namespaceURI === 'http://www.w3.org/1999/xhtml';
        if (native && node.tagName === 'textarea' && location?.startTag) {
          edits.push({ start: attrLocation.startOffset, end: attrLocation.endOffset, text: '' });
          // The HTML parser discards one initial LF in textarea text. Emit a
          // second LF so the parsed native value retains the requested first LF.
          const text = escapeText(prop.value);
          edits.push({ start: location.startTag.endOffset, end: location.endTag?.startOffset ?? location.endOffset,
            text: (text.startsWith('\n') ? '\n' : '') + text });
        } else if (native && node.tagName === 'select') {
          edits.push({ start: attrLocation.startOffset, end: attrLocation.endOffset, text: '' });
          let selected = false;
          const selectOption = (child: Tree.Node): void => {
            if ('tagName' in child && child.tagName === 'option') {
              const optionValue = child.attrs.find(attr => attr.name === '.value')?.value ??
                child.attrs.find(attr => attr.name === 'value')?.value ??
                textContent(child).replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
              const matches = !selected && optionValue === prop.value;
              selected ||= matches;
              const selectedLocation = child.sourceCodeLocation?.attrs?.selected;
              if (selectedLocation) edits.push({ start: selectedLocation.startOffset, end: selectedLocation.endOffset, text: '' });
              const end = child.sourceCodeLocation?.startTag?.endOffset;
              if (matches && end !== undefined) edits.push({ start: end - 1, end: end - 1, text: ' selected' });
            }
            if ('childNodes' in child) child.childNodes.forEach(selectOption);
          };
          node.childNodes.forEach(selectOption);
        } else {
          // Property values override a static default value attribute.
          const defaultValue = location?.attrs?.value;
          if (defaultValue) edits.push({ start: defaultValue.startOffset, end: defaultValue.endOffset, text: '' });
          edits.push({ start: attrLocation.startOffset, end: attrLocation.startOffset + '.value'.length, text: 'value' });
        }
      }
      if (node.tagName === 'template' && 'content' in node) visit(node.content as Tree.DocumentFragment);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(root);
  // Apply edits in one linear pass; re-slicing the whole document per edit is
  // quadratic once this runs over a full page.
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  let output = '';
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start > cursor) output += source.slice(cursor, edit.start);
    output += edit.text;
    cursor = Math.max(cursor, edit.end);
  }
  return output + source.slice(cursor);
};
