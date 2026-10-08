/* The webview only renders state; file and network access stay in the extension host. */
(() => {
  const vscode = acquireVsCodeApi();
  const { patch } = globalThis.NuGetDom;
  const model = globalThis.NuGetModel;
  const view = globalThis.NuGetView;
  const root = document.getElementById('app');
  const surface = document.body.classList.contains('surface-sidebar') ? 'sidebar' : 'editor';
  const narrow = window.matchMedia('(width < 780px)');
  const saved = vscode.getState() || {};
  const text = (value) => (typeof value === 'string' ? value : '');
  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
  const lower = (value) => String(value ?? '').toLowerCase();
  const packageId = (row) => `p:${lower(row.packageId)}`;
  const kindOf = (row) => (['major', 'minor', 'patch'].includes(row.updateKind) ? row.updateKind : 'other');
  const send = (type, data = {}) => vscode.postMessage({ type, ...data });

  let state = {
    rows: [],
    files: [],
    notices: [],
    feeds: [],
    busy: true,
    activity: 'scan',
    progress: 0,
    trusted: true,
    autoCheck: true,
    policy: 'latest',
    prerelease: false,
  };
  const ui = {
    view: saved.view === 'list' ? 'list' : 'groups',
    query: text(saved.query),
    group: text(saved.group),
    file: text(saved.file),
    kinds: new Set(list(saved.kinds)),
    showAll: saved.showAll === true,
    selected: new Set(list(saved.selected)),
    open: new Set(list(saved.open)),
    closed: new Set(list(saved.closed)),
    expanded: new Set(list(saved.expanded)),
    activeId: text(saved.activeId),
    cursor: text(saved.cursor),
    options: false,
    drawer: false,
    toast: '',
    failuresOpen: false,
    notesOpen: false,
  };
  /** Last settled update per declaration identity, shown dimmed while a recheck is running. */
  const known = new Map();
  const identity = (row) => `${row.file}|${lower(row.packageId)}|${row.version}`;
  let ctx;
  let scheduled = false;
  /** Selector focused right after the next render, once the target exists and is visible. */
  let focusAfter = '';
  /** Narrow views start with groups collapsed; wide views have room to show them open. */
  const groupOpen = (id) => (narrow.matches ? ui.open.has(id) : !ui.closed.has(id));

  function remember() {
    for (const row of state.rows) {
      if (row.status === 'update') known.set(identity(row), { target: row.target, updateKind: row.updateKind });
      else if (row.status === 'current' || row.status === 'error') known.delete(identity(row));
    }
  }

  /** Rows the current view can show: updates (plus dimmed previous updates while rechecking) or everything. */
  function baseRows() {
    const refreshing = state.busy || !!state.recheckPending;
    const rows = state.rows.map((row) => {
      const last = refreshing && (row.status === 'checking' || row.status === 'unchecked') && known.get(identity(row));
      return last ? { ...row, ...last, pending: true } : row;
    });
    return ui.showAll ? rows : rows.filter((row) => row.status === 'update' || row.pending);
  }

  function derive() {
    const base = baseRows();
    const filters = { query: ui.query, file: ui.file, kinds: [...ui.kinds] };
    const visible = model.filterRows(base, filters);
    const allGroups = model.groupView(base, visible);
    const selectedGroup = allGroups.find((group) => group.id === ui.group);
    const groups = ui.group ? (selectedGroup ? [selectedGroup] : []) : allGroups;
    const contentRows = groups.flatMap((group) => group.rows);
    const visibleUpdates = contentRows.filter((row) => row.status === 'update');
    const visibleKeys = new Set(visibleUpdates.map((row) => row.key));
    const failures = [];
    if (!ui.showAll && !ui.group)
      for (const row of model.filterRows(
        state.rows.filter((item) => item.status === 'error'),
        filters,
      ))
        if (!failures.some((item) => lower(item.packageId) === lower(row.packageId))) failures.push(row);
    const files = new Map();
    for (const row of contentRows) files.set(row.file, (files.get(row.file) ?? 0) + 1);
    const kindCounts = { major: 0, minor: 0, patch: 0, other: 0 };
    for (const kind of Object.keys(kindCounts))
      kindCounts[kind] = new Set(
        visibleUpdates.filter((row) => kindOf(row) === kind).map((row) => lower(row.packageId)),
      ).size;
    const familyNames = new Set();
    model.walk(model.familyNav(state.rows), (node) => familyNames.add(lower(node.name)));
    const activeRows = ui.activeId ? state.rows.filter((row) => packageId(row) === ui.activeId) : [];
    return {
      state,
      ui,
      surface,
      wide: !narrow.matches,
      summary: model.summarize(state.rows),
      allGroups,
      groups,
      packages: ui.view === 'list' ? model.packageList(contentRows) : [],
      groupName: ui.group === 'g:*' ? 'Other packages' : (selectedGroup?.name ?? ui.group.slice(2)),
      navTotal: model.summarize(visible).packages,
      visibleUpdates,
      visibleKeys: [...visibleKeys],
      selectedRows: visibleUpdates.filter((row) => ui.selected.has(row.key)),
      hiddenSelected: [...ui.selected].filter((key) => !visibleKeys.has(key)).length,
      failures,
      filtered: base.length > 0 && contentRows.length === 0,
      commonFile: [...files].sort((a, b) => b[1] - a[1])[0]?.[0],
      kindCounts,
      familyNames,
      feedText: state.feeds.map((feed) => feed.name).join(' + ') || 'nuget.org',
      active: activeRows.length
        ? {
            id: ui.activeId,
            name: activeRows[0].packageId,
            chain: activeRows[0].families?.length ? activeRows[0].families : [activeRows[0].packageId],
            rows: activeRows,
          }
        : undefined,
      activeId: ui.activeId,
      cursor: ui.cursor,
      isOpen: (group) => !!ui.query.trim() || !!ui.group || groups.length === 1 || groupOpen(group.id),
    };
  }

  function render() {
    scheduled = false;
    ctx = derive();
    patch(root, view.app(ctx));
    if (focusAfter) {
      root.querySelector(focusAfter)?.focus();
      focusAfter = '';
    }
    const rows = root.querySelectorAll('.tree [data-nav]');
    if (rows.length && ![...rows].some((row) => row.tabIndex === 0)) rows[0].tabIndex = 0;
    vscode.setState({
      view: ui.view,
      query: ui.query,
      group: ui.group,
      file: ui.file,
      kinds: [...ui.kinds],
      showAll: ui.showAll,
      selected: [...ui.selected],
      open: [...ui.open],
      closed: [...ui.closed],
      expanded: [...ui.expanded],
      activeId: ui.activeId,
      cursor: ui.cursor,
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  /** The node a checkbox, chip or action refers to, within what the view currently shows. */
  function findNode(id) {
    for (const group of ctx.groups) {
      if (group.id === id) return group;
      const found = group.subgroups.find((sub) => sub.id === id) ?? group.packages.find((node) => node.id === id);
      if (found) return found;
    }
    return ctx.packages.find((node) => node.id === id);
  }

  /** Keys a control acts on: only visible, available updates. */
  function keysFor(id) {
    if (id.startsWith('d:')) return [id.slice(2)];
    const node = findNode(id);
    return node ? model.collectKeys(node) : [];
  }

  function select(keys, on) {
    for (const key of keys) {
      if (on) ui.selected.add(key);
      else ui.selected.delete(key);
    }
  }

  function review(keys) {
    if (!keys.length) return;
    ui.selected = new Set(keys);
    ui.drawer = false;
    send('review', { keys });
  }

  function toggle(set, id, on) {
    if (on ?? !set.has(id)) set.add(id);
    else set.delete(id);
  }

  function toggleOpen(id, open) {
    if (id === 'failures') ui.failuresOpen = open ?? !ui.failuresOpen;
    else if (id.startsWith('g:')) {
      const next = open ?? !groupOpen(id);
      if (narrow.matches) toggle(ui.open, id, next);
      else toggle(ui.closed, id, !next);
    } else if (id.startsWith('p:')) toggle(ui.expanded, id, open);
    schedule();
  }

  function openDetails(id) {
    ui.activeId = id;
    if (narrow.matches) {
      ui.drawer = true;
      focusAfter = '.inspector .drawer-head button';
    }
  }

  /** The search box keeps its own value while focused, so clearing the query clears the box too. */
  function clearQuery() {
    ui.query = '';
    const input = document.getElementById('query');
    if (input) input.value = '';
  }

  function activate(row) {
    const id = row.dataset.nav;
    ui.cursor = id;
    if (id.startsWith('g:') || id === 'failures') toggleOpen(id);
    else if (id.startsWith('p:')) openDetails(id);
    else if (id.startsWith('d:')) openDetails(row.dataset.parent);
    else if (id.startsWith('f:')) {
      const failed = state.rows.find((item) => item.key === id.slice(2));
      if (failed) openDetails(packageId(failed));
    }
    schedule();
  }

  function clearFilter(name) {
    if (name === 'group') ui.group = '';
    else if (name === 'file') ui.file = '';
    else if (name === 'kinds') ui.kinds.clear();
    else if (name === 'showAll') ui.showAll = false;
    else if (name === 'policy') send('policy', { policy: 'latest', prerelease: state.prerelease });
    else if (name === 'prerelease') send('policy', { policy: state.policy, prerelease: false });
  }

  const actions = {
    refresh: () => send('refresh'),
    rescan: () => send('rescan'),
    cancel: () => send('cancel'),
    back: () => send('back'),
    apply: () => send('apply'),
    settings: () => send('settings'),
    openFolder: () => send('openFolder'),
    manageTrust: () => send('manageTrust'),
    preview: (button) => send('preview', { file: button.dataset.file }),
    openFile: (button) => send('openFile', { key: button.dataset.key }),
    packageLink: (button) => send('packageLink', { key: button.dataset.key }),
    'toggle-options': () => (ui.options = !ui.options),
    'toggle-notes': () => (ui.notesOpen = !ui.notesOpen),
    'toggle-decls': (button) => toggleOpen(button.dataset.id),
    dismiss: () => (ui.toast = ''),
    'clear-selection': () => ui.selected.clear(),
    'clear-query': () => {
      clearQuery();
      focusAfter = '#query';
    },
    'reset-filters': () => {
      clearQuery();
      ui.group = '';
      ui.file = '';
      ui.kinds.clear();
      ui.showAll = false;
    },
    'close-drawer': () => {
      ui.drawer = false;
      if (ui.activeId) focusAfter = `.tree [data-nav="${CSS.escape(ui.activeId)}"]`;
    },
    'review-selection': () =>
      review((ctx.selectedRows.length ? ctx.selectedRows : ctx.visibleUpdates).map((row) => row.key)),
    'review-group': (button) => review(keysFor(button.dataset.id)),
    'review-kind': (button) =>
      review(ctx.visibleUpdates.filter((row) => kindOf(row) === button.dataset.kindReview).map((row) => row.key)),
    'review-node': (button) =>
      review(
        state.rows
          .filter((row) => row.status === 'update' && packageId(row) === button.dataset.id)
          .map((row) => row.key),
      ),
  };

  function onButton(button) {
    const data = button.dataset;
    if (data.view) {
      ui.view = data.view === 'list' ? 'list' : 'groups';
      ui.cursor = '';
    } else if (data.group !== undefined) {
      ui.group = ui.group === data.group ? '' : data.group;
      ui.cursor = '';
    } else if (data.sub) {
      const keys = keysFor(data.sub);
      select(keys, model.selectionState(keys, ui.selected) !== 'all');
    } else if (data.searchMode) {
      const mode = model.searchModes[data.searchMode];
      if (mode) send('policy', { policy: mode.policy, prerelease: mode.prerelease });
    } else if (data.kindOnly) {
      const only = ui.kinds.size === 1 && ui.kinds.has(data.kindOnly);
      ui.kinds = new Set(only ? [] : [data.kindOnly]);
    } else if (data.kind) toggle(ui.kinds, data.kind);
    else if (data.clear) clearFilter(data.clear);
    else actions[data.action]?.(button);
    schedule();
  }

  root.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const button = target.closest('button');
    if (button) {
      if (!button.disabled) onButton(button);
      return;
    }
    if (target.closest('input, select, label')) return;
    if (target.closest('.scrim')) {
      actions['close-drawer']();
      schedule();
      return;
    }
    const row = target.closest('.tree [data-nav]');
    if (row) activate(row);
  });

  root.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset?.check) select(keysFor(input.dataset.check), input.checked);
    else if (input.id === 'select-all') select(ctx.visibleKeys, input.checked);
    else if (input.id === 'prerelease') send('policy', { policy: state.policy, prerelease: input.checked });
    else if (input.id === 'show-all') ui.showAll = input.checked;
    else if (input.id === 'file') ui.file = input.value;
    else if (input.dataset?.targetKey) send('target', { key: input.dataset.targetKey, version: input.value });
    schedule();
  });

  root.addEventListener('input', (event) => {
    if (event.target.id !== 'query') return;
    ui.query = event.target.value;
    ui.cursor = '';
    schedule();
  });

  function onTreeKey(event, row) {
    const rows = [...root.querySelectorAll('.tree [data-nav]')];
    const index = rows.indexOf(row);
    const id = row.dataset.nav;
    const expanded = row.getAttribute('aria-expanded');
    const move = (next) => {
      if (!next) return;
      ui.cursor = next.dataset.nav;
      next.focus();
      schedule();
    };
    if (event.key === 'ArrowDown') move(rows[index + 1]);
    else if (event.key === 'ArrowUp') move(rows[index - 1]);
    else if (event.key === 'Home') move(rows[0]);
    else if (event.key === 'End') move(rows.at(-1));
    else if (event.key === 'ArrowRight') {
      if (expanded === 'false') toggleOpen(id, true);
      else if (expanded === 'true') move(rows[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      if (expanded === 'true') toggleOpen(id, false);
      else move(rows.find((item) => item.dataset.nav === row.dataset.parent));
    } else if (event.key === ' ') {
      const box = row.querySelector('input.cb');
      if (box) select(keysFor(box.dataset.check), !box.checked);
      else if (expanded) toggleOpen(id);
      schedule();
    } else if (event.key === 'Enter') activate(row);
    else return;
    event.preventDefault();
  }

  document.addEventListener('keydown', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === 'Escape') {
      if (ui.drawer) actions['close-drawer']();
      else if (ui.options) ui.options = false;
      else if (target?.id === 'query' && ui.query) clearQuery();
      else return;
      event.preventDefault();
      schedule();
      return;
    }
    const row = target?.closest('.tree [data-nav]');
    if (row && target === row) onTreeKey(event, row);
  });

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (data?.type === 'state' && data.state) {
      state = data.state;
      remember();
      if (!state.busy && !state.recheckPending) {
        const valid = new Set(state.rows.filter((row) => row.status === 'update').map((row) => row.key));
        ui.selected = new Set([...ui.selected].filter((key) => valid.has(key)));
        if (ui.group && state.rows.length && !model.groupView(baseRows()).some((group) => group.id === ui.group))
          ui.group = '';
      }
      if (ui.file && !state.files.some((file) => file.uri === ui.file)) ui.file = '';
      if (ui.activeId && state.rows.length && !state.rows.some((row) => packageId(row) === ui.activeId)) {
        ui.activeId = '';
        ui.drawer = false;
      }
      schedule();
    } else if (data?.type === 'error') {
      ui.toast = String(data.message ?? 'NuGet operation failed');
      schedule();
    }
  });

  narrow.addEventListener('change', () => {
    if (!narrow.matches) ui.drawer = false;
    schedule();
  });

  render();
  send('ready');
})();
