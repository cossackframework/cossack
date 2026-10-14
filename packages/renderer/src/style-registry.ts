import { COMPONENT_STYLE_ATTRIBUTE, type FinalizedStyles } from './style-runtime';

/**
 * Client registry of component stylesheets.
 *
 * Each style root (a Document, or a ShadowRoot that rendered components live
 * in) holds one `<style data-cossack-style="<scope id>">` per scope, with a
 * count of the template instances that use it. In a document the element
 * lives in `<head>`; SSR puts it there too, and the first use adopts it.
 *
 * - Acquisitions resolve their root once their nodes are in a document or
 *   shadow root: synchronously at the end of a render that inserted them, so
 *   styles exist before `updated()`, layout reads or paint, or at the latest
 *   in a microtask.
 * - Releases wait for a macrotask. A client navigation tears down the old
 *   page and mounts the new one in one render, but nested components render
 *   in the microtasks that follow; waiting until they finished keeps every
 *   style the new page also uses, without removing and re-inserting it.
 */

type StyleRoot = Document | ShadowRoot;

interface StyleEntry {
  count: number;
  readonly element: HTMLStyleElement;
}

/** @internal One template instance's claim on a scope's stylesheet. */
export interface StyleUse {
  readonly styles: FinalizedStyles;
  /** A top-level node of the template instance, used to find its root. */
  anchor: Node;
  /** The root counted for this use; null until resolved or once released. */
  root: StyleRoot | null;
  released: boolean;
}

const registries = new WeakMap<StyleRoot, Map<string, StyleEntry>>();
const managedStyles = new WeakSet<Node>();
const pending = new Set<StyleUse>();
let releases: { root: StyleRoot; scopeId: string }[] = [];
let resolveScheduled = false;
let releaseScheduled = false;

const isDocument = (node: Node): node is Document => node.nodeType === 9;
const isShadowRoot = (node: Node): node is ShadowRoot =>
  typeof ShadowRoot !== 'undefined' && node instanceof ShadowRoot;

const styleRootOf = (anchor: Node, final: boolean): StyleRoot | null => {
  const root = anchor.getRootNode();
  if (isDocument(root) || isShadowRoot(root)) return root;
  // Still in a fragment or a detached tree. Wait for insertion, and only fall
  // back to the owning document once nothing else will place the nodes.
  return final ? anchor.ownerDocument : null;
};

const createStyle = (root: StyleRoot, { scopeId, cssText }: FinalizedStyles): HTMLStyleElement => {
  const doc = isDocument(root) ? root : root.ownerDocument;
  const element = doc.createElement('style');
  element.setAttribute(COMPONENT_STYLE_ATTRIBUTE, scopeId);
  element.textContent = cssText;
  if (isDocument(root)) {
    (root.head ?? root.documentElement)?.appendChild(element);
  } else {
    // Keep component styles together at the start of the shadow root, in
    // first-use order, ahead of rendered content.
    let reference = root.firstChild;
    while (reference && managedStyles.has(reference)) reference = reference.nextSibling;
    root.insertBefore(element, reference);
  }
  return element;
};

const attach = (use: StyleUse, root: StyleRoot): void => {
  let entries = registries.get(root);
  if (!entries) {
    entries = new Map();
    registries.set(root, entries);
  }
  const { scopeId } = use.styles;
  let entry = entries.get(scopeId);
  if (!entry) {
    // Adopt the server-rendered head style (or any copy already in this root).
    const existing = root.querySelector<HTMLStyleElement>(`style[${COMPONENT_STYLE_ATTRIBUTE}="${scopeId}"]`);
    entry = { count: 0, element: existing ?? createStyle(root, use.styles) };
    managedStyles.add(entry.element);
    entries.set(scopeId, entry);
  }
  entry.count++;
  use.root = root;
};

const resolvePending = (final: boolean): void => {
  for (const use of pending) {
    const root = styleRootOf(use.anchor, final);
    if (!root) continue;
    pending.delete(use);
    attach(use, root);
  }
};

const applyReleases = (): void => {
  releaseScheduled = false;
  resolvePending(true);
  const batch = releases;
  releases = [];
  for (const { root, scopeId } of batch) {
    const entries = registries.get(root);
    const entry = entries?.get(scopeId);
    if (!entry || --entry.count > 0) continue;
    entries!.delete(scopeId);
    managedStyles.delete(entry.element);
    entry.element.remove();
  }
};

const scheduleResolve = (): void => {
  if (resolveScheduled) return;
  resolveScheduled = true;
  queueMicrotask(() => {
    resolveScheduled = false;
    resolvePending(true);
  });
};

const scheduleRelease = (): void => {
  if (releaseScheduled) return;
  releaseScheduled = true;
  setTimeout(applyReleases, 0);
};

/** @internal Claim a scope's stylesheet for a new template instance. */
export const acquireStyle = (styles: FinalizedStyles, anchor: Node): StyleUse => {
  const use: StyleUse = { styles, anchor, root: null, released: false };
  pending.add(use);
  scheduleResolve();
  return use;
};

/** @internal Give up a claim. The style goes, a macrotask later, with the last claim in its root. */
export const releaseStyle = (use: StyleUse): void => {
  if (use.released) return;
  use.released = true;
  if (!use.root) {
    pending.delete(use);
    return;
  }
  releases.push({ root: use.root, scopeId: use.styles.scopeId });
  use.root = null;
  scheduleRelease();
};

/**
 * @internal Re-count a claim whose nodes moved to another root since it was
 * counted (for example a subtree moved into a shadow root).
 */
export const updateStyleRoot = (use: StyleUse): void => {
  if (use.released || !use.root || !use.anchor.isConnected) return;
  const root = use.anchor.getRootNode();
  if (root === use.root || !(isDocument(root) || isShadowRoot(root))) return;
  releases.push({ root: use.root, scopeId: use.styles.scopeId });
  attach(use, root);
  scheduleRelease();
};

/** @internal Count pending claims whose nodes now sit in a document or shadow root. */
export const flushStyleAcquisitions = (): void => {
  if (pending.size > 0) resolvePending(false);
};

/** @internal Whether a node is a registry-managed component style element. */
export const isManagedStyle = (node: Node): boolean => managedStyles.has(node);
