import { recordDevelopmentNativeEvidence, startDevelopmentTrace, type DevelopmentTraceSession, type DevelopmentTraceSnapshot,
  type DevelopmentComponentSnapshot, type DevelopmentInspectionOptions } from '@cossackframework/core/devtools';

const instances = new Map<string, WeakRef<object>>();
let current: BrowserDevTools | undefined;
const validFile = (file: unknown): file is string => typeof file === 'string' && file.length > 0 && file.length <= 4096 && !/[\u0000-\u001f\u007f]/.test(file);

/** Register the most recent instance for a source marker. Registration is weak and bounded. */
export function registerDevToolsInstance(file: string, instance: object): () => void {
  if (!import.meta.env.DEV || !validFile(file) || typeof WeakRef !== 'function') return () => {};
  const reference = new WeakRef(instance);
  instances.delete(file);
  if (instances.size >= 128) instances.delete(instances.keys().next().value!);
  instances.set(file, reference);
  return () => { if (instances.get(file) === reference) instances.delete(file); };
}

export interface BrowserDevTools {
  recordNativeEvidence(json: unknown): void;
  startCapture(options?: { capacity?: number }): DevelopmentTraceSession;
  stopCapture(): void;
  snapshot(): DevelopmentTraceSnapshot | null;
  inspect(file: string, options?: DevelopmentInspectionOptions): DevelopmentComponentSnapshot | null;
  dispose(): void;
}

/** Install one development inspector. Collection starts only through an explicit control or inspection gesture. */
export function enableDevTools(): BrowserDevTools | undefined {
  if (!import.meta.env.DEV || typeof document === 'undefined') return;
  if (current) return current;
  let capture: DevelopmentTraceSession | undefined;
  let disposed = false;
  let active: { file: string; start: Comment } | undefined;
  let lastX = 0, lastY = 0, cursorOwned = false, previousCursor = '';
  const overlay = document.createElement('div');
  overlay.dataset.cossackDevtools = 'highlight';
  Object.assign(overlay.style, { position: 'fixed', pointerEvents: 'none', background: 'rgba(59,130,246,.2)',
    border: '2px solid #3b82f6', zIndex: '999999', display: 'none', borderRadius: '4px' });
  const label = document.createElement('div');
  Object.assign(label.style, { position: 'absolute', top: '0', transform: 'translateY(-100%)', background: '#3b82f6',
    color: 'white', padding: '2px 6px', fontSize: '12px', whiteSpace: 'nowrap' });
  overlay.appendChild(label);
  const toolbar = document.createElement('div');
  toolbar.dataset.cossackDevtools = 'toolbar'; toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Cossack developer tools');
  toolbar.title = 'Ctrl-click opens source. Ctrl-Shift-click inspects a component.';
  Object.assign(toolbar.style, { position: 'fixed', bottom: '8px', right: '8px', zIndex: '1000000',
    display: 'flex', gap: '6px', padding: '6px', background: '#fff', color: '#111', border: '1px solid #777', borderRadius: '6px' });
  const record = document.createElement('button'), snapshot = document.createElement('button');
  record.type = snapshot.type = 'button'; record.textContent = 'Record trace'; snapshot.textContent = 'Log snapshot'; snapshot.disabled = true;
  record.setAttribute('aria-pressed', 'false'); toolbar.appendChild(record); toolbar.appendChild(snapshot); document.body.appendChild(overlay); document.body.appendChild(toolbar);

  const hide = () => {
    overlay.style.display = 'none'; active = undefined;
    if (cursorOwned && document.body.style.cursor === 'crosshair') document.body.style.cursor = previousCursor;
    cursorOwned = false;
  };
  const marker = (node: Node, prefix: string) => node.nodeType === Node.COMMENT_NODE && node.textContent?.startsWith(prefix);
  const findStart = (target: Node): Comment | undefined => {
    for (let node: Node | null = target; node; node = node.parentNode) {
      let depth = 0;
      for (let sibling = node.previousSibling; sibling; sibling = sibling.previousSibling) {
        if (marker(sibling, 'cossack-end:')) depth++;
        else if (marker(sibling, 'cossack-start:')) {
          if (depth === 0) return sibling as Comment;
          depth--;
        }
      }
    }
  };
  const findEnd = (start: Comment): Comment | undefined => {
    let depth = 0;
    for (let node = start.nextSibling; node; node = node.nextSibling) {
      if (marker(node, 'cossack-start:')) depth++;
      else if (marker(node, 'cossack-end:')) {
        if (depth === 0) return node as Comment;
        depth--;
      }
    }
  };
  const fileFor = (start: Comment): string | undefined => {
    try { const data = JSON.parse(start.data.slice('cossack-start:'.length)); return validFile(data?.file) ? data.file : undefined; }
    catch { return; }
  };
  const locate = (target: Node | null) => {
    if (!target || toolbar.contains(target)) return;
    const start = findStart(target), end = start && findEnd(start), file = start && fileFor(start);
    return start && end && file ? { start, end, file } : undefined;
  };
  const highlight = (target: Node | null) => {
    const found = locate(target); if (!found) { hide(); return; }
    const range = document.createRange(); range.setStartAfter(found.start); range.setEndBefore(found.end);
    const rect = range.getBoundingClientRect();
    active = { file: found.file, start: found.start };
    if (!cursorOwned) { previousCursor = document.body.style.cursor; cursorOwned = true; }
    document.body.style.cursor = 'crosshair';
    // A fixed overlay uses viewport coordinates, without document scroll offsets.
    Object.assign(overlay.style, { display: rect.width && rect.height ? 'block' : 'none', width: `${rect.width}px`,
      height: `${rect.height}px`, top: `${rect.top}px`, left: `${rect.left}px` });
    label.textContent = found.file.split('/').slice(-2).join('/');
  };
  const refreshControls = () => {
    const collecting = !!capture?.snapshot().collecting;
    record.textContent = collecting ? 'Stop trace' : 'Record trace'; record.setAttribute('aria-pressed', String(collecting));
    snapshot.disabled = !capture;
  };
  const tools: BrowserDevTools = {
    recordNativeEvidence(json) { if (!disposed) recordDevelopmentNativeEvidence(json); },
    startCapture(options) {
      if (disposed) throw new Error('This development inspector has been disposed.');
      capture = startDevelopmentTrace(options); refreshControls(); return capture;
    },
    stopCapture() { capture?.stop(); refreshControls(); },
    snapshot() { return disposed ? null : capture?.snapshot() ?? null; },
    inspect(file, options) {
      if (disposed || !capture || !validFile(file)) return null;
      const reference = instances.get(file), instance = reference?.deref();
      if (!instance) { instances.delete(file); return null; }
      return capture.inspect(instance, options);
    },
    dispose() {
      if (disposed) return;
      disposed = true; capture?.stop(); capture = undefined; hide(); overlay.remove(); toolbar.remove();
      window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('click', onClick, true);
      window.removeEventListener('blur', hide); window.removeEventListener('pagehide', onPageHide);
      record.removeEventListener('click', onRecord); snapshot.removeEventListener('click', onSnapshot);
      instances.clear(); if (current === tools) current = undefined;
    },
  };
  const onRecord = () => { if (capture?.snapshot().collecting) tools.stopCapture(); else tools.startCapture(); };
  const onSnapshot = () => { console.info('[Cossack DevTools] Trace snapshot', tools.snapshot()); refreshControls(); };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Control') highlight(document.elementFromPoint(lastX, lastY)); };
  const onKeyUp = (event: KeyboardEvent) => { if (event.key === 'Control') hide(); };
  const onMouseMove = (event: MouseEvent) => {
    lastX = event.clientX; lastY = event.clientY;
    if (event.ctrlKey) highlight(event.target as Node); else if (active) hide();
  };
  const onClick = (event: MouseEvent) => {
    if (!event.ctrlKey) return;
    const found = locate(event.target as Node); if (!found) return;
    event.preventDefault(); event.stopPropagation();
    if (event.shiftKey) {
      if (!capture?.snapshot().collecting) tools.startCapture();
      const result = tools.inspect(found.file);
      if (result) console.info('[Cossack DevTools] Component snapshot', result);
      else console.info('[Cossack DevTools] No registered component for this source marker.');
    } else {
      void fetch(`http://localhost:3333/open?file=${encodeURIComponent(found.file)}`)
        .catch(() => console.warn('[Cossack DevTools] Source editor service is unavailable.'));
    }
  };
  const onPageHide = (event: PageTransitionEvent) => { if (!event.persisted) tools.dispose(); else hide(); };
  record.addEventListener('click', onRecord); snapshot.addEventListener('click', onSnapshot);
  window.addEventListener('keydown', onKeyDown); window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove); window.addEventListener('click', onClick, true);
  window.addEventListener('blur', hide); window.addEventListener('pagehide', onPageHide);
  current = tools;
  return tools;
}

if (import.meta.hot) import.meta.hot.dispose(() => current?.dispose());
