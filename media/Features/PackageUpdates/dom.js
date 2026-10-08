/* Renderer utilities: escaping, icons and keyed DOM morphing that keeps scroll, focus and open controls. */
(() => {
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
    );

  const paths = {
    search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.5 3.5"/>',
    filter: '<path d="M2.5 3.5h11"/><path d="M4.5 8h7"/><path d="M6.5 12.5h3"/>',
    refresh: '<path d="M13.25 2.75v3.5h-3.5"/><path d="M13 6.25A5.25 5.25 0 1 0 13.25 9"/>',
    stop: '<rect x="4" y="4" width="8" height="8" rx="1.5"/>',
    close: '<path d="m4.25 4.25 7.5 7.5m0-7.5-7.5 7.5"/>',
    chevron: '<path d="m6 3.75 4.25 4.25L6 12.25"/>',
    down: '<path d="m3.75 6 4.25 4.25L12.25 6"/>',
    up: '<path d="M8 13.25V3.25"/><path d="M3.75 7.5 8 3.25l4.25 4.25"/>',
    back: '<path d="M13 8H3.25"/><path d="M7.25 3.75 3 8l4.25 4.25"/>',
    warning: '<path d="M8 2.25 1.75 13.25h12.5z"/><path d="M8 6.5v3.25M8 11.5v.25"/>',
    error: '<circle cx="8" cy="8" r="5.75"/><path d="M8 4.75v4M8 10.75v.25"/>',
    info: '<circle cx="8" cy="8" r="5.75"/><path d="M8 7.25v4M8 4.75V5"/>',
    pass: '<circle cx="8" cy="8" r="5.75"/><path d="m5.5 8.25 1.75 1.75 3.25-3.75"/>',
    file: '<path d="M9.25 1.75h-5.5v12.5h8.5v-9.5z"/><path d="M9.25 1.75v3h3"/>',
    external: '<path d="M9 2.75h4.25V7"/><path d="M13.25 2.75 7.5 8.5"/><path d="M11.75 9.5v3.75H2.75v-9H6.5"/>',
    gear: '<circle cx="8" cy="8" r="2"/><path d="M8 1.75v1.5M8 12.75v1.5M14.25 8h-1.5M3.25 8h-1.5M12.4 3.6l-1.06 1.06M4.66 11.34 3.6 12.4M12.4 12.4l-1.06-1.06M4.66 4.66 3.6 3.6"/>',
    package: '<path d="M8 1.75 13.75 4.5v7L8 14.25 2.25 11.5v-7z"/><path d="M2.25 4.5 8 7.25l5.75-2.75M8 7.25v7"/>',
    diff: '<path d="M4.5 2.25v11.5M11.5 2.25v11.5"/><path d="M2.25 5h4.5M9.25 11h4.5M11.5 8.75v4.5"/>',
    folder: '<path d="M1.75 3.75h4.5l1.5 1.5h6.5v7H1.75z"/>',
    shield: '<path d="M8 1.75 13 3.5v4c0 3.25-2.25 5.5-5 6.75C5.25 13 3 10.75 3 7.5v-4z"/>',
    collapse: '<path d="M2.75 4.75h10.5M2.75 8h10.5M2.75 11.25h6"/>',
  };
  const nuget =
    '<svg class="icon mark" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor" stroke="none" transform="translate(1 0.8) scale(0.82)"><circle cx="3.65" cy="4.06" r="2.75"/><path d="M19.52,5.65H12.84A6.91,6.91,0,0,0,5.9,12.57v6.68a6.91,6.91,0,0,0,6.91,6.91h6.68a6.91,6.91,0,0,0,6.91-6.92V12.57A6.91,6.91,0,0,0,19.52,5.65Zm-6.75,7.47A2,2,0,1,1,13,10.6,2,2,0,0,1,12.77,13.12Zm6.63,9.69a3.5,3.5,0,1,1,3.5-3.5A3.5,3.5,0,0,1,19.4,22.81Z"/></g></svg>';
  const icon = (name, className = '') =>
    name === 'nuget'
      ? nuget
      : `<svg class="icon ${className}" viewBox="0 0 16 16" aria-hidden="true">${paths[name] ?? ''}</svg>`;

  const keyOf = (node) => (node.nodeType === 1 ? node.getAttribute('data-k') : null);
  const sameKind = (a, b) => a.nodeType === b.nodeType && a.nodeName === b.nodeName;

  function morphNode(from, to) {
    if (from.nodeType !== 1) {
      if (from.nodeValue !== to.nodeValue) from.nodeValue = to.nodeValue;
      return;
    }
    for (const { name } of [...from.attributes]) if (!to.hasAttribute(name)) from.removeAttribute(name);
    for (const { name, value } of [...to.attributes])
      if (from.getAttribute(name) !== value) from.setAttribute(name, value);
    if (from.nodeName === 'INPUT') {
      if (from.type === 'checkbox' || from.type === 'radio') {
        from.checked = to.hasAttribute('checked');
        from.indeterminate = to.hasAttribute('data-mixed');
      } else if (document.activeElement !== from && from.value !== (to.getAttribute('value') ?? '')) {
        from.value = to.getAttribute('value') ?? '';
      }
      return;
    }
    morphChildren(from, to);
    if (from.nodeName === 'SELECT') {
      const chosen = [...from.options].find((option) => option.hasAttribute('selected'));
      if (chosen && from.value !== chosen.value) from.value = chosen.value;
      else if (!chosen && from.selectedIndex !== 0) from.selectedIndex = 0;
    }
  }

  function morphChildren(from, to) {
    const nextNodes = [...to.childNodes];
    const wanted = new Set(nextNodes.map(keyOf).filter(Boolean));
    const keyed = new Map();
    for (const node of [...from.childNodes]) {
      const key = keyOf(node);
      // Drop keyed nodes that disappear first, so survivors are never moved (a moved node loses its scroll).
      if (key && !wanted.has(key)) node.remove();
      else if (key) keyed.set(key, node);
    }
    let cursor = from.firstChild;
    for (const next of nextNodes) {
      const key = keyOf(next);
      let match = null;
      if (key) {
        match = keyed.get(key) ?? null;
        keyed.delete(key);
        if (match && !sameKind(match, next)) match = null;
      } else if (cursor && !keyOf(cursor) && sameKind(cursor, next)) match = cursor;
      if (!match) {
        from.insertBefore(next, cursor);
        continue;
      }
      if (match === cursor) cursor = cursor.nextSibling;
      else from.insertBefore(match, cursor);
      morphNode(match, next);
    }
    while (cursor) {
      const stale = cursor;
      cursor = cursor.nextSibling;
      stale.remove();
    }
  }

  /** Replaces container content with html while reusing matching nodes. */
  function patch(container, html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    morphChildren(container, template.content);
    for (const input of container.querySelectorAll('input[data-mixed]')) input.indeterminate = true;
  }

  globalThis.NuGetDom = { esc, icon, patch };
})();
