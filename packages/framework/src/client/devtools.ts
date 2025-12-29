console.log('[Cossack] DevTools module loaded');

export function enableDevTools() {
  if (!import.meta.env.DEV) {
      console.log('[Cossack] DevTools disabled (not in DEV mode)');
      return;
  }

  console.log('[Cossack] DevTools enabled (Hold Alt to inspect)');

  let activeComponent: { file: string, startNode: Comment, endNode: Comment } | null = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
      position: 'fixed',
      pointerEvents: 'none',
      background: 'rgba(59, 130, 246, 0.3)',
      border: '2px solid #3b82f6',
      zIndex: '999999',
      display: 'none',
      borderRadius: '4px'
  });
  document.body.appendChild(overlay);

  const label = document.createElement('div');
  Object.assign(label.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      transform: 'translateY(-100%)',
      background: '#3b82f6',
      color: 'white',
      padding: '2px 6px',
      fontSize: '10px',
      fontFamily: 'monospace',
      borderTopLeftRadius: '2px',
      borderTopRightRadius: '2px',
      whiteSpace: 'nowrap'
  });
  overlay.appendChild(label);

  function isStartMarker(node: Node): boolean {
      return node.nodeType === Node.COMMENT_NODE && (node.textContent?.startsWith('cossack-start:') ?? false);
  }
  
  function getMarkerData(node: Node) {
      if (!node.textContent) return null;
      try {
          const json = node.textContent.replace('cossack-start:', '');
          return JSON.parse(json);
      } catch (e) {
          return null;
      }
  }

  function findComponent(target: Node) {
      let node: Node | null = target;
      while (node) {
          let sibling = node.previousSibling;
          while (sibling) {
              if (isStartMarker(sibling)) {
                  return sibling as Comment;
              }
              sibling = sibling.previousSibling;
          }
          node = node.parentNode;
      }
      return null;
  }

  function findEndMarker(startNode: Comment): Comment | null {
      let current: Node | null = startNode.nextSibling;
      let depth = 0;
      const startContent = startNode.textContent!;
      const expectedEndContent = startContent.replace('cossack-start:', 'cossack-end:');

      while (current) {
          if (current.nodeType === Node.COMMENT_NODE) {
             if (current.textContent === startContent) {
                 depth++;
             } else if (current.textContent === expectedEndContent) {
                 if (depth === 0) return current as Comment;
                 depth--;
             }
          }
          current = current.nextSibling;
      }
      return null;
  }

  const inspectAt = (target: Node | null) => {
      if (!target) return;
      
      const startNode = findComponent(target);
      
      if (startNode) {
          const endNode = findEndMarker(startNode);
          if (endNode) {
              const data = getMarkerData(startNode);
              if (data) {
                  // Optimization: Don't recalculate if same component
                  if (activeComponent && activeComponent.startNode === startNode) return;

                  activeComponent = { file: data.file, startNode, endNode };
                  
                  const range = document.createRange();
                  range.setStartAfter(startNode);
                  range.setEndBefore(endNode);
                  const rect = range.getBoundingClientRect();
                  
                  if (rect.width > 0 && rect.height > 0) {
                      overlay.style.display = 'block';
                      overlay.style.width = rect.width + 'px';
                      overlay.style.height = rect.height + 'px';
                      overlay.style.top = (rect.top + window.scrollY) + 'px';
                      overlay.style.left = (rect.left + window.scrollX) + 'px';
                      
                      const parts = data.file.split('/');
                      const fileName = parts.pop();
                      const parentDir = parts.pop();
                      label.textContent = parentDir ? `${parentDir}/${fileName}` : fileName;
                  }
                  return;
              }
          }
      }
      
      overlay.style.display = 'none';
      activeComponent = null;
  }

  const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
          document.body.style.cursor = 'crosshair';
          // Check what's under the mouse immediately
          const target = document.elementFromPoint(lastMouseX, lastMouseY);
          inspectAt(target);
      }
  };

  const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
          document.body.style.cursor = '';
          overlay.style.display = 'none';
          activeComponent = null;
      }
  };

  const onMouseMove = (e: MouseEvent) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;

      if (e.altKey) {
          inspectAt(e.target as Node);
      } else if (activeComponent) {
          // If Alt is released but we are moving, hide the overlay
          // This handles cases where keyup might have been missed or order of events
          overlay.style.display = 'none';
          activeComponent = null;
          document.body.style.cursor = '';
      }
  };

  const onClick = (e: MouseEvent) => {
      if (e.altKey && activeComponent) {
          e.preventDefault();
          e.stopPropagation();
          const { file } = activeComponent;
          console.log('[Cossack] Opening file:', file);
          fetch(`http://localhost:3333/open?file=${encodeURIComponent(file)}`)
            .catch(err => console.error('[Cossack] Failed to open file via dev-tools server:', err));
      }
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('click', onClick, true); // Capture phase
}
