/** Restore an explicitly identified control after a same-owner page replacement. */
export function captureNavigationFocus(root: Element): () => void {
  const document = root.ownerDocument;
  const source = document.activeElement;
  if (!(source instanceof HTMLElement) || !root.contains(source) || !source.id) return () => {};
  const id = source.id;
  const unique = () => [...document.querySelectorAll<HTMLElement>('[id]')].filter(node => node.id === id);
  if (unique().length !== 1) return () => {};
  const tag = source.tagName;
  const type = source.getAttribute('type');
  const name = source.getAttribute('name');
  const text = source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement ? source : undefined;
  const selection = text && text.selectionStart !== null
    ? { start: text.selectionStart, end: text.selectionEnd!, direction: text.selectionDirection!, value: text.value }
    : undefined;
  return () => {
    // Keep intentional focus moves and retained DOM owners. Never focus a duplicate ID.
    if (source.isConnected || (document.activeElement !== document.body && document.activeElement !== null)) return;
    const candidates = unique();
    const target = candidates[0];
    if (candidates.length !== 1 || !root.contains(target) || target.tagName !== tag ||
      target.getAttribute('type') !== type || target.getAttribute('name') !== name) return;
    target.focus({ preventScroll: true });
    if (document.activeElement === target && selection &&
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.value === selection.value) {
      target.setSelectionRange(selection.start, selection.end, selection.direction);
    }
  };
}
