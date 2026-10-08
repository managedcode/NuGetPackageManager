/* The webview only renders state; file and network access stay in the extension host. */
(() => {
  const vscode = acquireVsCodeApi();
  const remembered = vscode.getState() || {};
  let state = {
    rows: [],
    files: [],
    notices: [],
    feeds: [],
    busy: false,
    progress: 0,
    trusted: true,
    policy: 'latest',
    prerelease: false,
  };
  let detailOpen = false;
  let selected = new Set(remembered.selected || []);
  let query = remembered.query || '';
  let group = remembered.group || '';
  let file = remembered.file || '';
  let tab = remembered.tab || 'updates';
  let kind = remembered.kind || '';
  let activeKey = remembered.activeKey || '';
  let toast = '';
  const app = document.getElementById('app');
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x],
    );
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });
  const icons = {
    nuget:
      '<g fill="currentColor" stroke="none" transform="translate(1 0.8) scale(0.82)"><circle cx="3.65" cy="4.06" r="2.75"/><path d="M19.52,5.65H12.84A6.91,6.91,0,0,0,5.9,12.57v6.68a6.91,6.91,0,0,0,6.91,6.91h6.68a6.91,6.91,0,0,0,6.91-6.92V12.57A6.91,6.91,0,0,0,19.52,5.65Zm-6.75,7.47A2,2,0,1,1,13,10.6,2,2,0,0,1,12.77,13.12Zm6.63,9.69a3.5,3.5,0,1,1,3.5-3.5A3.5,3.5,0,0,1,19.4,22.81Z"/></g>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.2 6.5A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.8 5.5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    file: '<path d="M14 3H6v18h12V7l-4-4Z"/><path d="M14 3v5h4M9 12h6M9 16h6"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 5H4v15h15v-6"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
    back: '<path d="M19 12H5m6-6-6 6 6 6"/>',
    warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v1"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.nuget}</svg>`;
  const disabled = (yes) => (yes ? 'disabled' : '');
  const updates = () => state.rows.filter((row) => row.status === 'update');
  const selectedRows = () => state.rows.filter((row) => selected.has(row.key) && row.status === 'update');
  const inFamily = (row, name) =>
    !name || (row.families || [row.group]).some((value) => value.toLowerCase() === name.toLowerCase());
  const familyUpdates = () => state.rows.filter((row) => row.status === 'update' && inFamily(row, group));
  const visible = () =>
    state.rows.filter(
      (row) =>
        (tab !== 'updates' ||
          row.status === 'update' ||
          row.status === 'error' ||
          row.status === 'unchecked' ||
          row.status === 'checking') &&
        inFamily(row, group) &&
        (!file || row.file === file) &&
        (!kind || row.updateKind === kind) &&
        `${row.packageId} ${row.fileLabel}`.toLowerCase().includes(query.toLowerCase()),
    );
  const persist = () => vscode.setState({ selected: [...selected], query, group, file, tab, kind, activeKey });
  const badge = (row) =>
    row.status === 'update'
      ? `<span class="badge ${row.updateKind}">${esc(row.updateKind)}</span>`
      : `<span class="badge ${row.status}">${esc({ current: 'current', error: 'failed', unchecked: 'not checked', checking: 'checking' }[row.status])}</span>`;

  let rendering = false;
  let pendingRender = false;
  function render() {
    if (rendering) {
      pendingRender = true;
      return;
    }
    rendering = true;
    try {
      renderView();
    } finally {
      rendering = false;
      if (pendingRender) {
        pendingRender = false;
        queueMicrotask(render);
      }
    }
  }
  function renderView() {
    const focused = document.activeElement?.id;
    const caret = document.activeElement?.selectionStart;
    const rows = visible();
    const ready = updates();
    const picked = selectedRows();
    const roots = new Set(state.rows.map((row) => row.group.toLowerCase()));
    const groups = [
      ...new Map(
        state.rows.flatMap((row) => row.families || [row.group]).map((name) => [name.toLowerCase(), name]),
      ).values(),
    ]
      .filter((name) => roots.has(name.toLowerCase()) || state.rows.filter((row) => inFamily(row, name)).length >= 2)
      .sort();
    const active = rows.find((row) => row.key === activeKey) || rows[0];
    const unchecked = state.rows.some((row) => row.status === 'unchecked');
    const failed = state.rows.filter((row) => row.status === 'error').length;
    app.innerHTML = `<div class="shell">
      <header class="topbar"><div class="brand"><span class="brand-mark">${icon('nuget')}</span><span>NuGet <strong>Package Manager</strong><small>by ManagedCode</small></span></div><div class="top-actions"><span class="feed-label"><i></i>${esc(state.feeds.map((feed) => feed.name).join(' + ') || 'nuget.org')}</span><button class="icon-button" id="settings" data-action="settings" aria-label="Configure package feeds">${icon('settings')}</button></div></header>
      <section class="hero"><div><div class="eyebrow">PACKAGE UPDATES</div><h1>Update families together.</h1><p>Choose a family. Review the complete change set.</p></div><button class="primary" data-action="${state.busy ? 'cancel' : 'refresh'}" ${disabled(state.busy && !!state.plan)}>${icon(state.busy ? 'back' : 'refresh')}${state.busy ? 'Cancel check' : 'Check for updates'}</button></section>
      <div class="summary"><div><span class="metric">${state.rows.length}</span><span>Declarations</span></div><div><span class="metric accent">${ready.length}</span><span>Available updates</span></div><div><span class="metric">${state.files.filter((f) => f.count).length}</span><span>Package files</span></div><div class="scan-status">${state.busy ? `<progress max="100" value="${state.progress}" aria-label="Update check progress"></progress><span>Checking feeds · ${state.progress}%</span>` : `<span class="status-dot"></span><span>${state.checkedAt ? `Checked ${esc(new Date(state.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}` : 'Ready to check'}${failed ? ` · ${failed} failed` : ''}</span>`}</div></div>
      ${!state.trusted ? `<div class="notice">${icon('warning')} Restricted Mode: trust this workspace to apply package updates.</div>` : ''}
      ${toast ? `<div class="notice error" role="alert">${icon('warning')}${esc(toast)}<button data-action="dismiss" aria-label="Dismiss message">×</button></div>` : ''}
      ${
        state.plan
          ? renderPlan(state.plan)
          : `<div class="workbench">
        <aside class="sidebar"><div class="section-label">PACKAGE FAMILIES</div><button class="family ${!group ? 'active' : ''}" data-group=""><span>All packages</span><span class="count">${ready.length}</span></button>${groups.map((name) => `<button class="family ${group.toLowerCase() === name.toLowerCase() ? 'active' : ''} ${roots.has(name.toLowerCase()) ? '' : 'subfamily'}" title="${esc(name)}" aria-label="${esc(name)} ${ready.filter((row) => inFamily(row, name)).length}" data-group="${esc(name)}"><span class="family-name">${esc(roots.has(name.toLowerCase()) ? name : name.slice(name.indexOf('.') + 1))}</span><span class="count">${ready.filter((row) => inFamily(row, name)).length}</span></button>`).join('')}<button class="primary family-update" data-action="update-family" ${disabled(state.busy || !familyUpdates().length || !state.trusted)}>${icon('arrow')}Review ${familyUpdates().length} ${group ? 'family' : 'all'} updates</button><p class="family-hint">${group ? `${esc(group)} · all files` : 'All families · all files'}</p><div class="sidebar-note">${icon('file')}<span>Central versions and project references, in one place.</span></div></aside>
        <main class="package-panel"><div class="tabs" role="tablist" aria-label="Package views"><button role="tab" aria-selected="${tab === 'updates'}" class="${tab === 'updates' ? 'active' : ''}" data-tab="updates">Updates <span>${ready.length}</span></button><button role="tab" aria-selected="${tab === 'all'}" class="${tab === 'all' ? 'active' : ''}" data-tab="all">All packages <span>${state.rows.length}</span></button></div>
          <div class="filters"><label class="search">${icon('search')}<input id="query" type="search" placeholder="Filter packages…" aria-label="Filter packages" value="${esc(query)}"></label><select id="file" aria-label="Package file"><option value="">All package files</option>${state.files
            .filter((f) => f.count)
            .map((f) => `<option value="${esc(f.uri)}" ${f.uri === file ? 'selected' : ''}>${esc(f.label)}</option>`)
            .join('')}</select></div>
          <div class="policy-bar"><label>Target <select id="policy" aria-label="Update policy" ${disabled(state.busy)}><option value="latest" ${state.policy === 'latest' ? 'selected' : ''}>Latest available</option><option value="minor" ${state.policy === 'minor' ? 'selected' : ''}>Within current major</option><option value="patch" ${state.policy === 'patch' ? 'selected' : ''}>Within current minor</option></select></label><label class="check-label"><input id="prerelease" type="checkbox" ${state.prerelease ? 'checked' : ''} ${disabled(state.busy)}>Include prerelease</label><select id="kind" aria-label="Update type"><option value="">All update types</option>${['patch', 'minor', 'major', 'revision', 'prerelease'].map((value) => `<option value="${value}" ${kind === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
          <div class="list-toolbar"><label class="check-label"><input id="select-visible" type="checkbox" ${rows.filter((r) => r.status === 'update').length && rows.filter((r) => r.status === 'update').every((r) => selected.has(r.key)) ? 'checked' : ''} ${disabled(state.busy || !rows.some((r) => r.status === 'update'))}>Select visible</label><span>${rows.length} shown</span><button class="text-button" data-action="select-patches" ${disabled(state.busy || !rows.some((r) => r.updateKind === 'patch'))}>Select patches</button></div>
          <div class="package-list" role="region" aria-label="Package declarations">${rows.length ? rows.map((row) => `<div class="package-row ${active?.key === row.key ? 'focused' : ''} ${selected.has(row.key) ? 'selected' : ''}"><input type="checkbox" data-select="${esc(row.key)}" aria-label="Select ${esc(row.packageId)} in ${esc(row.fileLabel)}" ${selected.has(row.key) ? 'checked' : ''} ${disabled(state.busy || row.status !== 'update')}><button class="package-identity" data-focus="${esc(row.key)}"><span class="package-icon">${esc(row.group.slice(0, 2).toUpperCase())}</span><span class="package-name">${esc(row.packageId)}<small title="${esc(row.fileLabel)}">${esc(row.fileLabel)}${row.condition ? ` · ${esc(row.condition)}` : ''}</small></span></button><div class="version-change"><code>${esc(row.version)}</code><span>→</span><code class="${row.target ? 'target' : ''}">${esc(row.target || (row.status === 'error' ? 'unavailable' : row.status === 'current' ? row.version : '—'))}</code></div>${badge(row)}</div>`).join('') : renderEmpty(unchecked)}</div>
          <footer class="selection-bar"><div><strong>${picked.length} selected</strong><small>${picked.length ? `${new Set(picked.map((row) => row.file)).size} file${new Set(picked.map((row) => row.file)).size === 1 ? '' : 's'} will change` : 'Choose the updates you want to apply'}</small></div><button class="primary" data-action="review" ${disabled(state.busy || !picked.length || !state.trusted)}>Review changes ${icon('arrow')}</button></footer>
        </main>${renderDetail(active)}
      </div>`
      }
      ${state.notices.length ? `<details class="scan-notices"><summary>${icon('warning')} ${state.notices.length} scan note${state.notices.length === 1 ? '' : 's'}</summary><ul>${state.notices.map((note) => `<li>${esc(note)}</li>`).join('')}</ul></details>` : ''}
      <footer class="page-footer"><span>Small, deliberate updates.</span><span>Review → Apply → Restore & test</span></footer>
    </div>`;
    if (focused) {
      const element = document.getElementById(focused);
      if (element) {
        element.focus();
        if (typeof caret === 'number' && element.setSelectionRange) element.setSelectionRange(caret, caret);
      }
    }
    persist();
  }

  function renderEmpty(unchecked) {
    const noPackages = !state.rows.length;
    return `<div class="empty">${icon(noPackages ? 'cube' : 'check')}<h2>${noPackages ? 'Bring your .NET workspace.' : query || group || file || kind ? 'No matching packages.' : 'Nothing to update here.'}</h2><p>${noPackages ? 'Open a folder containing Directory.Packages.props or .NET project files, then check for updates.' : unchecked ? 'Check the configured feeds to find available versions.' : 'Try another filter, or check all packages for their current status.'}</p><button class="secondary" data-action="${query || group || file || kind ? 'clear-filters' : 'refresh'}" ${disabled(state.busy)}>${query || group || file || kind ? 'Clear filters' : 'Refresh workspace'}</button></div>`;
  }

  function renderDetail(row) {
    if (!row)
      return `<button class="detail-backdrop ${detailOpen ? 'open' : ''}" data-action="close-detail" aria-label="Close package details"></button><aside class="detail ${detailOpen ? 'open' : ''}"><button class="detail-close secondary" data-action="close-detail">${icon('back')} Back to packages</button><div class="section-label">PACKAGE DETAILS</div><p>Select a package to see its versions and declaration.</p></aside>`;
    const choices = row.versions.slice().reverse();
    return `<button class="detail-backdrop ${detailOpen ? 'open' : ''}" data-action="close-detail" aria-label="Close package details"></button><aside class="detail ${detailOpen ? 'open' : ''}"><button class="detail-close secondary" data-action="close-detail">${icon('back')} Back to packages</button><div class="section-label">PACKAGE DETAILS</div><div class="detail-mark">${icon('nuget')}</div><h2>${esc(row.packageId)}</h2><span class="detail-family">${esc(row.group)} family</span><dl><div><dt>Installed declaration</dt><dd><code>${esc(row.version)}</code></dd></div><div><dt>Update type</dt><dd>${badge(row)}</dd></div></dl>${row.target ? `<label class="target-label" for="target-version">Target version</label><select id="target-version" data-key="${esc(row.key)}" ${disabled(state.busy)}>${choices.map((version) => `<option ${version === row.target ? 'selected' : ''}>${esc(version)}</option>`).join('')}</select><p class="detail-hint">A version comparison does not guarantee framework or API compatibility.</p>` : `<p class="detail-hint ${row.error ? 'failure' : ''}">${esc(row.error || (row.status === 'current' ? 'No newer version matches your target policy.' : 'Check for updates to load available versions.'))}</p>`}<div class="declaration"><span class="section-label">DECLARED IN</span><p>${icon('file')}${esc(row.fileLabel)}</p>${row.condition ? `<p class="condition-note">Condition: ${esc(row.condition)}</p>` : ''}<span class="declaration-kind">${esc(row.kind)}</span></div><button class="secondary full" data-action="openFile" data-key="${esc(row.key)}">Open declaration ${icon('external')}</button><button class="text-button full" data-action="packageLink" data-key="${esc(row.key)}">View on nuget.org ${icon('external')}</button></aside>`;
  }

  function renderPlan(plan) {
    const files = [...new Set(plan.map((change) => change.file))];
    const major = plan.filter(
      (change) => state.rows.find((row) => row.key === change.key)?.updateKind === 'major',
    ).length;
    return `<main class="review-panel"><button class="text-button" data-action="back" ${disabled(state.busy)}>${icon('back')} Back to packages</button><div class="review-heading"><div class="eyebrow">ONE LAST LOOK</div><h2>Review ${plan.length} package update${plan.length === 1 ? '' : 's'}.</h2><p>${files.length} file${files.length === 1 ? '' : 's'} will be edited.${major ? ` ${major} major update${major === 1 ? '' : 's'} selected; review breaking changes before applying.` : ' Only the selected version declarations will change.'}</p></div>${files
      .map(
        (file) =>
          `<section class="review-file"><header><span>${icon('file')}${esc(plan.find((change) => change.file === file).fileLabel)}</span><button class="secondary" data-action="preview" data-file="${esc(file)}">Open diff ${icon('external')}</button></header>${plan
            .filter((change) => change.file === file)
            .map(
              (change) =>
                `<div class="review-row"><strong>${esc(change.packageId)}${change.condition ? `<small>${esc(change.condition)}</small>` : ''}</strong><code class="old-version">${esc(change.from)}</code>${icon('arrow')}<code class="target">${esc(change.to)}</code></div>`,
            )
            .join('')}</section>`,
      )
      .join(
        '',
      )}<div class="review-bottom"><p>${icon('check')} Versions are saved using VS Code edits. Shared central versions affect every project that consumes them. Restore and test your solution afterward.</p><button class="primary" data-action="apply" ${disabled(state.busy || !state.trusted)}>${state.busy ? 'Applying…' : `Apply ${plan.length} update${plan.length === 1 ? '' : 's'}`} ${icon('arrow')}</button></div></main>`;
  }

  app.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    if (button.dataset.group !== undefined) {
      group = button.dataset.group;
      render();
      return;
    }
    if (button.dataset.tab) {
      tab = button.dataset.tab;
      render();
      return;
    }
    if (button.dataset.focus) {
      activeKey = button.dataset.focus;
      detailOpen = true;
      render();
      return;
    }
    const action = button.dataset.action;
    if (action === 'close-detail') {
      detailOpen = false;
      render();
    } else if (action === 'update-family') {
      selected = new Set(familyUpdates().map((row) => row.key));
      send('review', { keys: [...selected] });
      persist();
    } else if (action === 'review') send('review', { keys: selectedRows().map((row) => row.key) });
    else if (action === 'select-patches') {
      visible()
        .filter((row) => row.updateKind === 'patch')
        .forEach((row) => selected.add(row.key));
      render();
    } else if (action === 'clear-filters') {
      query = '';
      group = '';
      file = '';
      kind = '';
      render();
    } else if (action === 'dismiss') {
      toast = '';
      render();
    } else if (action) send(action, { key: button.dataset.key, file: button.dataset.file });
  });
  app.addEventListener('input', (event) => {
    if (event.target.id === 'query') {
      query = event.target.value;
      render();
    }
  });
  app.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.select) {
      if (input.checked) selected.add(input.dataset.select);
      else selected.delete(input.dataset.select);
    } else if (input.id === 'select-visible')
      visible()
        .filter((row) => row.status === 'update')
        .forEach((row) => {
          if (input.checked) selected.add(row.key);
          else selected.delete(row.key);
        });
    else if (input.id === 'file') file = input.value;
    else if (input.id === 'kind') kind = input.value;
    else if (input.id === 'policy' || input.id === 'prerelease') {
      send('policy', {
        policy: document.getElementById('policy').value,
        prerelease: document.getElementById('prerelease').checked,
      });
      return;
    } else if (input.id === 'target-version') {
      send('target', { key: input.dataset.key, version: input.value });
      return;
    }
    render();
  });
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'state') {
      state = event.data.state;
      const valid = new Set(updates().map((row) => row.key));
      selected = new Set([...selected].filter((key) => valid.has(key)));
      if (!state.files.some((f) => f.uri === file)) file = '';
      if (group && !state.rows.some((row) => inFamily(row, group))) group = '';
      render();
    } else if (event.data?.type === 'error') {
      toast = event.data.message;
      render();
    }
  });
  render();
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && detailOpen) {
      detailOpen = false;
      render();
    }
  });
  send('ready');
})();
