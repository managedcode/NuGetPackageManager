/* Workbench templates: groups first, a flat list on demand. Dynamic values are escaped; data-k keys let morphing reuse nodes. */
(() => {
  const { esc, icon } = globalThis.NuGetDom;
  const { collectKeys, selectionState, versionDiff, searchModes, searchMode } = globalThis.NuGetModel;

  const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
  const attr = (name, on) => (on ? ` ${name}` : '');
  const policyLabel = (state) => searchModes[searchMode(state.policy, state.prerelease)].label;
  const kinds = { major: 'Major', minor: 'Minor', patch: 'Patch', other: 'Other' };
  const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const spinner = '<span class="spinner" aria-hidden="true"></span>';
  const lower = (value) => String(value ?? '').toLowerCase();
  const distinct = (rows) => new Set(rows.map((row) => lower(row.packageId))).size;
  const updatesOf = (rows) => rows.filter((row) => row.status === 'update');
  const kindOf = (row) => (['major', 'minor', 'patch'].includes(row.updateKind) ? row.updateKind : 'other');
  const groupLabel = (group) => (group.other ? 'Other packages' : group.name);

  /** Full package or group ID; a muted shared prefix, query matches marked and line breaks only after dots. */
  function nameHtml(name, query = '', prefix = 0) {
    const needle = query.trim().toLowerCase();
    const at = needle ? name.toLowerCase().indexOf(needle) : -1;
    const runs = [];
    for (let index = 0; index < name.length; index++) {
      const cls = [index < prefix ? 'pre' : '', at >= 0 && index >= at && index < at + needle.length ? 'hit' : '']
        .filter(Boolean)
        .join(' ');
      const text = esc(name[index]) + (name[index] === '.' ? '<wbr>' : '');
      if (runs.length && runs.at(-1).cls === cls) runs.at(-1).text += text;
      else runs.push({ cls, text });
    }
    return runs.map((run) => (run.cls ? `<span class="${run.cls}">${run.text}</span>` : run.text)).join('');
  }

  /** Length of the group prefix a member shares, e.g. "Aspire." in Aspire.Hosting.Orleans. */
  function sharedPrefix(name, group) {
    if (!group || group.other) return 0;
    const prefix = `${lower(group.name)}.`;
    return lower(name).startsWith(prefix) && name.length > prefix.length ? prefix.length : 0;
  }

  /** Subgroup chips are read next to their group header, so they show only the narrower part. */
  function relative(name, group) {
    return name.slice(sharedPrefix(name, group));
  }

  function versionHtml(row) {
    if (row.status === 'update' || row.pending) {
      const { same, changed } = versionDiff(row.version, row.target);
      const tags = String(row.target).includes('-') ? '<span class="tag">pre</span>' : '';
      return `<span class="ver">${tags}<span class="from">${esc(row.version)}</span><span class="arrow" aria-label="to">→</span><span class="to">${esc(same)}<b>${esc(changed)}</b></span></span>`;
    }
    if (row.status === 'error')
      return `<span class="ver failed" title="${esc(row.error)}">${icon('error')}<span class="from">${esc(row.version)}</span></span>`;
    if (row.status === 'checking')
      return `<span class="ver">${spinner}<span class="from">${esc(row.version)}</span></span>`;
    return `<span class="ver ${esc(row.status)}"><span class="cur">${esc(row.version)}</span></span>`;
  }

  function packageVersion(node) {
    const updates = node.rows.filter((row) => row.status === 'update' || row.pending);
    const shown = updates.length ? updates : node.rows;
    const from = new Set(shown.map((row) => row.version));
    const to = new Set(shown.map((row) => row.target));
    if (from.size === 1 && to.size === 1) return versionHtml(shown[0]);
    const one = (set) => (set.size === 1 ? esc([...set][0]) : 'mixed');
    return `<span class="ver"><span class="from">${one(from)}</span>${updates.length ? `<span class="arrow" aria-label="to">→</span><span class="to"><b>${one(to)}</b></span>` : ''}</span>`;
  }

  function checkbox(id, keys, ctx, label) {
    if (!keys.length) return '<span class="cb" aria-hidden="true"></span>';
    const state = selectionState(keys, ctx.ui.selected);
    return `<input type="checkbox" class="cb" tabindex="-1" data-check="${esc(id)}" aria-label="${esc(label)}"${attr('checked', state === 'all')}${attr('data-mixed', state === 'some')}>`;
  }

  function ariaChecked(keys, ctx) {
    if (!keys.length) return '';
    const state = selectionState(keys, ctx.ui.selected);
    return ` aria-checked="${state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}"`;
  }

  /** Second line of a group row: the shared version change, or what kinds of updates it holds. */
  function groupSummary(group, ctx) {
    const updates = group.rows.filter((row) => row.status === 'update' || row.pending);
    const prefix = ctx.ui.showAll ? `${plural(group.count, 'package')} · ` : '';
    if (!updates.length) return `${prefix}up to date`;
    const pairs = new Set(updates.map((row) => `${row.version}\u0000${row.target}`));
    if (pairs.size === 1) return `${prefix}${esc(updates[0].version)} → ${esc(updates[0].target)}`;
    const parts = Object.keys(kinds)
      .map((kind) => [kind, distinct(updates.filter((row) => kindOf(row) === kind))])
      .filter(([, count]) => count)
      .map(([kind, count]) => `${count} ${kind}`);
    return `${prefix}${parts.join(' · ')}`;
  }

  function groupRow(group, ctx) {
    const open = ctx.isOpen(group);
    const keys = collectKeys(group);
    const name = groupLabel(group);
    const count = distinct(updatesOf(group.rows));
    const pending = group.rows.every((row) => row.pending);
    const update = keys.length
      ? `<button class="btn ghost sm" data-action="review-group" data-id="${esc(group.id)}" title="Update ${esc(plural(count, 'package'))} in ${esc(name)}"${attr('disabled', ctx.state.busy || !ctx.state.trusted)}>Update</button>`
      : '';
    return `<div class="grp${open ? ' open' : ''}${pending ? ' pending' : ''}" role="treeitem" aria-level="1" aria-expanded="${open}" data-k="${esc(group.id)}" data-nav="${esc(group.id)}" data-parent="" tabindex="${ctx.cursor === group.id ? 0 : -1}"><span class="tw">${icon('chevron')}</span><span class="grp-name" title="${esc(name)}"><span>${group.other ? name : nameHtml(name, ctx.ui.query)}</span>${count ? `<span class="count">${count}</span>` : ''}</span><span class="grp-sum">${groupSummary(group, ctx)}</span>${update}</div>`;
  }

  /** Nested families of a group as one-click selections, e.g. Orleans inside Microsoft. */
  function subgroups(group, ctx) {
    const chips = group.subgroups
      .map((sub) => {
        const keys = collectKeys(sub);
        if (!keys.length) return '';
        const count = distinct(updatesOf(sub.rows));
        return `<button class="sub" data-sub="${esc(sub.id)}" aria-pressed="${selectionState(keys, ctx.ui.selected) === 'all'}" title="Select ${esc(plural(count, 'update'))} in ${esc(sub.name)}">${esc(relative(sub.name, group))}<span>${count}</span></button>`;
      })
      .join('');
    return chips ? `<div class="subs" data-k="subs:${esc(group.id)}">${chips}</div>` : '';
  }

  function packageMeta(node, ctx) {
    const files = new Set(node.rows.map((row) => row.file)).size;
    if (node.rows.length > 1) return files > 1 ? plural(files, 'file') : plural(node.rows.length, 'declaration');
    const [row] = node.rows;
    return [row.file !== ctx.commonFile ? row.fileLabel : '', row.condition ? 'conditional' : '']
      .filter(Boolean)
      .join(' · ');
  }

  function declarationRow(row, node, ctx, level) {
    const id = `d:${row.key}`;
    const keys = row.status === 'update' ? [row.key] : [];
    return `<div class="pkg decl${row.pending ? ' pending' : ''}" role="treeitem" aria-level="${level}" data-k="${esc(id)}" data-nav="${esc(id)}" data-parent="${esc(node.id)}"${ariaChecked(keys, ctx)} tabindex="${ctx.cursor === id ? 0 : -1}">${checkbox(id, keys, ctx, `Select ${node.name} in ${row.fileLabel}`)}<span class="pkg-name" title="${esc(row.fileLabel)}">${icon('file', 'file')}${esc(row.fileLabel)}</span>${versionHtml(row)}${row.condition ? `<span class="pkg-meta">${esc(row.condition)}</span>` : ''}</div>`;
  }

  function packageRow(node, ctx, group) {
    const keys = collectKeys(node);
    const multi = node.rows.length > 1;
    const open = multi && ctx.ui.expanded.has(node.id);
    const meta = packageMeta(node, ctx);
    const level = group ? 2 : 1;
    const classes = ['pkg', group ? 'in-group' : '', ctx.activeId === node.id ? 'active' : '']
      .concat(node.rows.every((row) => row.pending) ? ['pending'] : [])
      .filter(Boolean)
      .join(' ');
    const more = multi
      ? `<button class="more" data-action="toggle-decls" data-id="${esc(node.id)}" aria-expanded="${open}" tabindex="-1">${esc(meta)}${icon('down')}</button>`
      : esc(meta);
    let html = `<div class="${classes}" role="treeitem" aria-level="${level}" data-k="${esc(node.id)}" data-nav="${esc(node.id)}" data-parent="${esc(group?.id ?? '')}"${multi ? ` aria-expanded="${open}"` : ''}${ariaChecked(keys, ctx)} tabindex="${ctx.cursor === node.id ? 0 : -1}">${checkbox(node.id, keys, ctx, `Select ${node.name}`)}<span class="pkg-name" title="${esc(node.name)}">${nameHtml(node.name, ctx.ui.query, sharedPrefix(node.name, group))}</span>${packageVersion(node)}${meta ? `<span class="pkg-meta">${more}</span>` : ''}</div>`;
    if (open) for (const row of node.rows) html += declarationRow(row, node, ctx, level + 1);
    return html;
  }

  function failureRows(ctx) {
    if (ctx.ui.showAll || !ctx.failures.length) return '';
    const open = ctx.ui.failuresOpen;
    let html = `<div class="grp failures${open ? ' open' : ''}" role="treeitem" aria-level="1" aria-expanded="${open}" data-k="failures" data-nav="failures" data-parent="" tabindex="${ctx.cursor === 'failures' ? 0 : -1}"><span class="tw">${icon('chevron')}</span><span class="grp-name err">${icon('error')}<span>Couldn't check</span><span class="count err">${ctx.failures.length}</span></span><span class="grp-sum">The feed returned an error; these are not up to date</span></div>`;
    if (open)
      for (const row of ctx.failures)
        html += `<div class="pkg in-group failure" role="treeitem" aria-level="2" data-k="f:${esc(row.key)}" data-nav="f:${esc(row.key)}" data-parent="failures" tabindex="${ctx.cursor === `f:${row.key}` ? 0 : -1}"><span class="cb"></span><span class="pkg-name">${nameHtml(row.packageId)}</span><span class="ver"><span class="from">${esc(row.version)}</span></span><span class="pkg-meta wrap">${esc(row.error || 'Check failed')}</span></div>`;
    return html;
  }

  function rowsHtml(ctx) {
    if (ctx.ui.view === 'list') return ctx.packages.map((node) => packageRow(node, ctx, null)).join('');
    return ctx.groups
      .map(
        (group) =>
          groupRow(group, ctx) +
          (ctx.isOpen(group)
            ? `${subgroups(group, ctx)}${group.packages.map((node) => packageRow(node, ctx, group)).join('')}`
            : ''),
      )
      .join('');
  }

  function empty(ctx) {
    const { state, summary, ui } = ctx;
    if (ctx.groups.length || ctx.packages.length) return '';
    const card = (id, glyph, title, text, button = '') =>
      `<div class="empty" data-k="empty-${id}">${icon(glyph)}<h3>${title}</h3><p>${text}</p>${button}</div>`;
    const btn = (actionName, label, primary = false) =>
      `<button class="btn ${primary ? 'primary' : 'secondary'}" data-action="${actionName}"${attr('disabled', state.busy)}>${label}</button>`;
    if (!state.rows.length && (state.busy || state.recheckPending))
      return `<div class="skeleton" data-k="skeleton" aria-label="Scanning workspace">${'<div class="sk"><i></i><b></b><u></u></div>'.repeat(7)}</div>`;
    if (!state.rows.length && state.notices.some((note) => note.startsWith('Open a folder')))
      return card(
        'folder',
        'folder',
        'No folder open',
        'Open a folder with .NET projects to manage its NuGet packages.',
        btn('openFolder', 'Open Folder', true),
      );
    if (!state.rows.length)
      return card(
        'none',
        'package',
        'No NuGet packages found',
        'Looked in Directory.Packages.props, .csproj, .fsproj and .vbproj files.',
        btn('rescan', 'Rescan'),
      );
    if (ctx.filtered)
      return card(
        'filtered',
        'search',
        'No matching packages',
        'Nothing matches the current search or filters.',
        btn('reset-filters', 'Clear filters'),
      );
    if (ui.showAll) return '';
    if (state.busy || state.recheckPending)
      return card(
        'checking',
        'refresh',
        'Looking for updates…',
        `Checking ${plural(summary.packages, 'package')} against ${esc(ctx.feedText)}.`,
      );
    if (summary.unchecked + summary.checking === summary.packages)
      return card(
        'unchecked',
        'refresh',
        'Updates not checked',
        `Check ${esc(ctx.feedText)} for newer versions of ${plural(summary.packages, 'package')}.`,
        btn('refresh', 'Check for updates', true),
      );
    if (!ctx.failures.length)
      return card(
        'current',
        'pass',
        'Everything is up to date',
        `${plural(summary.packages, 'package')} checked${state.checkedAt ? ` at ${clock(state.checkedAt)}` : ''} · ${esc(policyLabel(state))}`,
        btn('refresh', 'Check again'),
      );
    return '';
  }

  function notes(ctx) {
    const list = ctx.state.notices;
    if (!list.length) return '';
    const open = ctx.ui.notesOpen;
    return `<div class="notes" data-k="notes"><button class="link" data-action="toggle-notes" aria-expanded="${open}">${icon('info')}${plural(list.length, 'scan note')}</button>${open ? `<ul>${list.map((note) => `<li>${esc(note)}</li>`).join('')}</ul>` : ''}</div>`;
  }

  function statusText(ctx) {
    const { state, summary } = ctx;
    if (state.busy || state.recheckPending) {
      const label =
        {
          scan: 'Scanning workspace…',
          check: `Checking ${summary.packages - summary.checking} of ${summary.packages}…`,
          resolve: 'Applying version policy…',
          review: 'Preparing review…',
          apply: 'Applying updates…',
        }[state.activity] ?? 'Refreshing…';
      const stoppable = state.recheckPending || state.activity === 'scan' || state.activity === 'check';
      return `${spinner}<span>${label}</span>${stoppable ? '<button class="link" data-action="cancel">Stop</button>' : ''}`;
    }
    if (!summary.packages) return '';
    if (summary.unchecked === summary.packages) return '<span class="muted">Not checked</span>';
    const failed = summary.failed ? ` <span class="err">· ${summary.failed} failed</span>` : '';
    const total = ctx.ui.showAll ? ` <span class="muted">· ${plural(summary.packages, 'package')}</span>` : '';
    return `<span><strong>${summary.updates ? plural(summary.updates, 'update') : 'Up to date'}</strong>${total}${failed}</span>`;
  }

  function viewbar(ctx) {
    const { ui, state } = ctx;
    const tab = (id, label) =>
      `<button role="tab" data-view="${id}" aria-selected="${ui.view === id}" tabindex="${ui.view === id ? 0 : -1}">${label}</button>`;
    return `<div class="viewbar" data-k="viewbar"><div class="switch" role="tablist" aria-label="View">${tab('groups', 'Groups')}${tab('list', 'List')}</div><label class="check pre" title="Include prerelease (preview) versions when looking for updates"><input type="checkbox" id="prerelease"${attr('checked', state.prerelease)}${attr('disabled', state.busy)}>Prerelease</label></div>`;
  }

  function listHead(ctx) {
    if (ctx.ui.view !== 'list' || !ctx.visibleKeys.length) return '';
    const state = selectionState(ctx.visibleKeys, ctx.ui.selected);
    return `<div class="list-head" data-k="list-head"><input type="checkbox" class="cb" id="select-all"${attr('checked', state === 'all')}${attr('data-mixed', state === 'some')}><label for="select-all">Select all</label></div>`;
  }

  function footer(ctx) {
    const { state, summary } = ctx;
    const busy = state.busy || state.recheckPending;
    const chosen = ctx.selectedRows;
    const target = chosen.length ? chosen : ctx.visibleUpdates;
    if (!busy && !target.length) return '';
    const files = new Set(target.map((row) => row.file)).size;
    const failed = summary.failed && !chosen.length ? ` <span class="err">· ${summary.failed} failed</span>` : '';
    const hidden = ctx.hiddenSelected ? ` · ${ctx.hiddenSelected} hidden` : '';
    const text = busy
      ? statusText(ctx)
      : chosen.length
        ? `<strong>${distinct(chosen)} selected</strong><span class="muted">· ${plural(files, 'file')}${hidden}</span><button class="link" data-action="clear-selection">Clear</button>`
        : `<strong>${plural(distinct(target), 'update')}</strong><span class="muted">· ${plural(files, 'file')}</span>${failed}`;
    const label = chosen.length ? `Update ${plural(distinct(chosen), 'package')}` : 'Update all';
    const button = target.length
      ? `<button class="btn primary" data-action="review-selection"${attr('disabled', state.busy || !state.trusted)} title="${state.trusted ? 'Review the exact version changes before applying' : 'Trust this workspace to apply updates'}">${label}</button>`
      : '';
    const checked = state.checkedAt ? ` title="Checked ${clock(state.checkedAt)} · ${esc(ctx.feedText)}"` : '';
    return `<footer class="footer" data-k="footer"><div class="sel" id="status" role="status"${checked}>${text}</div>${button}</footer>`;
  }

  function toolbar(ctx) {
    const { ui, state } = ctx;
    const filtered = ui.file || ui.kinds.size || ui.showAll || state.policy !== 'latest';
    const stoppable = state.recheckPending || (state.busy && (state.activity === 'scan' || state.activity === 'check'));
    const check =
      ctx.surface !== 'editor'
        ? ''
        : stoppable
          ? `<button class="icon-btn" data-action="cancel" title="Stop" aria-label="Stop">${icon('stop')}</button>`
          : `<button class="icon-btn" data-action="refresh" title="Check for updates" aria-label="Check for updates"${attr('disabled', state.busy)}>${icon('refresh')}</button>`;
    return `<div class="toolbar" data-k="toolbar"><label class="search">${icon('search')}<input id="query" type="search" placeholder="Search packages" aria-label="Search packages" autocomplete="off" spellcheck="false" value="${esc(ui.query)}">${ui.query ? `<button class="icon-btn sm" data-action="clear-query" title="Clear search" aria-label="Clear search">${icon('close')}</button>` : ''}</label><button class="icon-btn${ui.options ? ' on' : ''}" data-action="toggle-options" aria-expanded="${ui.options}" aria-controls="options" title="Filters and version policy" aria-label="Filters and version policy">${icon('filter')}${filtered ? '<i class="dot"></i>' : ''}</button>${check}</div>`;
  }

  function options(ctx) {
    const { ui, state } = ctx;
    if (!ui.options) return '';
    const files = state.files.filter((file) => file.count);
    const policy = Object.entries(searchModes)
      .map(
        ([value, mode]) =>
          `<button role="radio" aria-checked="${searchMode(state.policy, state.prerelease) === value}" data-search-mode="${value}" title="${esc(mode.description)}"${attr('disabled', state.busy)}>${esc(mode.label)}</button>`,
      )
      .join('');
    const types = Object.entries(kinds)
      .map(([value, label]) => `<button aria-pressed="${ui.kinds.has(value)}" data-kind="${value}">${label}</button>`)
      .join('');
    const fileField =
      files.length > 1
        ? `<div class="field"><span class="field-label">Package file</span><select id="file" aria-label="Package file"><option value="">All files</option>${files.map((file) => `<option value="${esc(file.uri)}"${attr('selected', file.uri === ui.file)}>${esc(file.label)}</option>`).join('')}</select></div>`
        : '';
    return `<div class="options" id="options" data-k="options"><div class="field"><span class="field-label">Versions</span><div class="segmented" role="radiogroup" aria-label="Update search">${policy}</div></div><div class="field"><span class="field-label">Show</span><div class="toggles">${types}</div><label class="check"><input type="checkbox" id="show-all"${attr('checked', ui.showAll)}>Show up-to-date packages</label></div>${fileField}<div class="field-foot"><button class="link" data-action="reset-filters">Reset</button><button class="link" data-action="toggle-options">Done</button></div></div>`;
  }

  function chips(ctx) {
    const { ui, state } = ctx;
    if (ui.options) return '';
    const items = [];
    const chip = (id, label, className = '') =>
      `<span class="chip${className}"><span>${esc(label)}</span><button data-clear="${id}" aria-label="Remove ${esc(label)} filter">${icon('close')}</button></span>`;
    if (ui.group && !ctx.wide) items.push(chip('group', ctx.groupName));
    if (state.policy !== 'latest') items.push(chip('policy', policyLabel(state)));
    if (ui.kinds.size) items.push(chip('kinds', [...ui.kinds].map((kind) => kinds[kind]).join(', ')));
    if (ui.file) items.push(chip('file', state.files.find((file) => file.uri === ui.file)?.label ?? 'File'));
    if (ui.showAll) items.push(chip('showAll', 'Up-to-date shown'));
    return items.length ? `<div class="chips" data-k="chips">${items.join('')}</div>` : '';
  }

  function progress(ctx) {
    const { state } = ctx;
    if (state.busy && state.activity === 'check')
      return `<progress class="bar" max="100" value="${state.progress}" aria-label="Update check progress"></progress>`;
    return state.busy || state.recheckPending ? '<div class="bar indeterminate" aria-hidden="true"></div>' : '';
  }

  function banners(ctx) {
    const { ui, state } = ctx;
    let html = '';
    if (ui.toast)
      html += `<div class="banner error" role="alert">${icon('error')}<span>${esc(ui.toast)}</span><button class="icon-btn sm" data-action="dismiss" title="Dismiss" aria-label="Dismiss">${icon('close')}</button></div>`;
    if (!state.trusted)
      html += `<div class="banner warning">${icon('shield')}<span>Restricted Mode. Trust this workspace to apply updates.</span><button class="link" data-action="manageTrust">Manage</button></div>`;
    return html ? `<div class="banners" data-k="banners">${html}</div>` : '';
  }

  function declaration(row, ctx) {
    const choices = row.versions.slice().reverse();
    const target =
      row.status === 'update' && choices.length
        ? `<select class="target" data-target-key="${esc(row.key)}" aria-label="Target version in ${esc(row.fileLabel)}"${attr('disabled', ctx.state.busy)}>${choices.map((version) => `<option value="${esc(version)}"${attr('selected', version === row.target)}>${esc(version)}</option>`).join('')}</select>${row.updateKind ? `<span class="tag">${esc(row.updateKind)}</span>` : ''}`
        : `<span class="muted${row.status === 'error' ? ' err' : ''}">${esc({ current: 'Up to date', error: row.error || 'Check failed', checking: 'Checking…', unchecked: 'Not checked' }[row.status] ?? '')}</span>`;
    return `<div class="decl-card" data-k="dc:${esc(row.key)}"><div class="decl-file">${icon('file')}<span title="${esc(row.fileLabel)}">${esc(row.fileLabel)}</span><button class="link" data-action="openFile" data-key="${esc(row.key)}">Open</button></div><div class="decl-meta">${esc(row.kind)}${row.condition ? ` · ${esc(row.condition)}` : ''}</div><div class="decl-grid"><span class="label">Current</span><span class="mono">${esc(row.version)}</span><span class="label">Target</span><span class="target-cell">${target}</span></div></div>`;
  }

  function overview(ctx) {
    const { state } = ctx;
    const counts = ctx.kindCounts;
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (!total)
      return `<div class="insp-empty" data-k="insp-empty">${icon('package')}<p>Select a package to see its declarations and available versions.</p></div>`;
    const notesByKind = {
      major: 'First number changed',
      minor: 'Second number changed',
      patch: 'Third number changed',
      other: 'Revision or prerelease changed',
    };
    const rows = Object.keys(kinds)
      .filter((kind) => counts[kind])
      .map(
        (kind) =>
          `<button class="kind-row" data-kind-only="${kind}" aria-pressed="${ctx.ui.kinds.size === 1 && ctx.ui.kinds.has(kind)}" title="Show only ${kind} updates"><span class="tag">${kind}</span><span>${notesByKind[kind]}</span><span class="count">${counts[kind]}</span></button>`,
      )
      .join('');
    return `<div class="insp" data-k="insp-overview"><div class="insp-head"><span class="insp-mark">${icon('nuget')}</span><div class="insp-title"><h2>${plural(total, 'update')}</h2><div class="crumbs">${state.checkedAt ? `Checked ${clock(state.checkedAt)} · ` : ''}${esc(ctx.feedText)}</div></div></div><div class="kinds">${rows}</div><p class="fine">Select a package to see its declarations and available versions.</p></div>`;
  }

  function inspector(ctx) {
    const node = ctx.active;
    const head = `<div class="drawer-head"><button class="icon-btn" data-action="close-drawer" title="Back to packages" aria-label="Back to packages">${icon('back')}</button><span>Details</span></div>`;
    let body = overview(ctx);
    if (node) {
      const updates = updatesOf(node.rows);
      const status = updates.length
        ? `${icon('up')}<span>Update available</span>`
        : node.rows.some((row) => row.status === 'error')
          ? `${icon('error', 'err')}<span>Check failed</span>`
          : node.rows.every((row) => row.status === 'current')
            ? `${icon('pass')}<span>Up to date</span>`
            : `${icon('info')}<span>${node.rows.some((row) => row.status === 'checking') ? 'Checking…' : 'Not checked'}</span>`;
      const families = node.chain.slice(0, -1).filter((name) => ctx.familyNames.has(lower(name)));
      const path = families
        .map((name, index) => esc(index ? name.slice(families[index - 1].length + 1) : name))
        .join('<span class="sep">›</span>');
      body = `<div class="insp" data-k="insp:${esc(node.id)}"><div class="insp-head"><span class="insp-mark">${icon('nuget')}</span><div class="insp-title"><h2>${nameHtml(node.name)}</h2>${path ? `<div class="crumbs">${path}</div>` : ''}</div></div><div class="insp-status">${status}</div><div class="section-label">${plural(node.rows.length, 'Declaration')}</div>${node.rows.map((row) => declaration(row, ctx)).join('')}<div class="insp-actions">${updates.length ? `<button class="btn primary" data-action="review-node" data-id="${esc(node.id)}"${attr('disabled', ctx.state.busy || !ctx.state.trusted)}>Update</button>` : ''}<button class="btn secondary" data-action="packageLink" data-key="${esc(node.rows[0].key)}">${icon('external')}nuget.org</button></div><p class="fine">A newer version does not guarantee framework or API compatibility. Restore and test after updating.</p></div>`;
    }
    return `<aside class="inspector${ctx.ui.drawer ? ' open' : ''}" data-k="inspector" aria-label="Package details">${head}${body}</aside>`;
  }

  function nav(ctx) {
    const item = (id, label, count) =>
      `<button class="fam${ctx.ui.group === id ? ' active' : ''}" data-group="${esc(id)}" aria-pressed="${ctx.ui.group === id}" title="${esc(label)}"><span class="fam-name">${esc(label)}</span>${count ? `<span class="count">${count}</span>` : ''}</button>`;
    const groups = ctx.allGroups.map((group) => item(group.id, groupLabel(group), group.count)).join('');
    return `<nav class="families" data-k="families" aria-label="Groups"><div class="section-label">Groups</div>${item('', ctx.ui.showAll ? 'All packages' : 'All updates', ctx.navTotal)}${groups}</nav>`;
  }

  function review(ctx) {
    const { state } = ctx;
    const plan = state.plan;
    const byKey = new Map(state.rows.map((row) => [row.key, row]));
    const files = [...new Set(plan.map((change) => change.file))];
    const packages = new Set(plan.map((change) => lower(change.packageId))).size;
    const central = plan.some((change) => byKey.get(change.key)?.kind === 'PackageVersion');
    const sections = files
      .map((file) => {
        const changes = plan.filter((change) => change.file === file);
        const rows = changes
          .map((change) => {
            const row = byKey.get(change.key) ?? {};
            return `<div class="review-row"><span class="nm">${nameHtml(change.packageId)}${change.condition ? `<span class="meta">${esc(change.condition)}</span>` : ''}</span>${versionHtml({ ...row, status: 'update', version: change.from, target: change.to })}</div>`;
          })
          .join('');
        return `<section class="review-file" data-k="rf:${esc(file)}"><header>${icon('file')}<span class="path" title="${esc(changes[0].fileLabel)}">${esc(changes[0].fileLabel)}</span><span class="count">${changes.length}</span><button class="btn secondary sm" data-action="preview" data-file="${esc(file)}">${icon('diff')}Diff</button></header>${rows}</section>`;
      })
      .join('');
    const notices = central
      ? `<div class="banner info">${icon('info')}<span>Central package versions apply to every project that uses them.</span></div>`
      : '';
    return `<section class="review" data-k="review" aria-label="Review updates"><header class="review-head"><button class="icon-btn" data-action="back" title="Back to packages" aria-label="Back to packages"${attr('disabled', state.busy)}>${icon('back')}</button><div><h2>Update ${plural(packages, 'package')}</h2><p>${plural(plan.length, 'change')} in ${plural(files.length, 'file')}</p></div></header><div class="review-body">${notices}${sections}</div><footer class="review-foot"><p class="fine">Edits go through VS Code and can be undone. Files with unsaved changes stay unsaved.</p><div class="buttons"><button class="btn secondary" data-action="back"${attr('disabled', state.busy)}>Back</button><button class="btn primary" data-action="apply"${attr('disabled', state.busy || !state.trusted)}>${state.activity === 'apply' ? 'Applying…' : `Apply ${plural(plan.length, 'change')}`}</button></div></footer></section>`;
  }

  function masthead(ctx) {
    if (ctx.surface !== 'editor')
      return `<header class="sidebar-launch" data-k="sidebar-launch"><button class="btn secondary sm" data-action="openEditor" title="Open NuGet Package Manager in an editor tab">${icon('external')}Open manager</button></header>`;
    return `<header class="masthead" data-k="masthead"><span class="brand-mark">${icon('nuget')}</span><span class="brand"><strong>NuGet Package Manager</strong><span>by ManagedCode</span></span><span class="feeds" title="Configured feeds"><i></i>${esc(ctx.feedText)}</span><button class="icon-btn" data-action="settings" title="Configure package feeds" aria-label="Configure package feeds">${icon('gear')}</button></header>`;
  }

  /** The whole workbench for one state snapshot. */
  function app(ctx) {
    const head = masthead(ctx) + banners(ctx);
    if (ctx.state.plan?.length) return `${head}${review(ctx)}`;
    const list = `<section class="list" data-k="list">${listHead(ctx)}<div class="tree view-${ctx.ui.view}" role="tree" aria-label="Packages" aria-multiselectable="true" data-k="tree">${rowsHtml(ctx)}${failureRows(ctx)}${empty(ctx)}${notes(ctx)}</div>${footer(ctx)}</section>`;
    return `${head}<div class="controls" data-k="controls">${toolbar(ctx)}${options(ctx)}${chips(ctx)}${viewbar(ctx)}${progress(ctx)}</div><div class="layout" data-k="layout">${nav(ctx)}${list}<div class="scrim${ctx.ui.drawer ? ' open' : ''}" data-action="close-drawer" data-k="scrim"></div>${inspector(ctx)}</div>`;
  }

  globalThis.NuGetView = { app };
})();
