/*
 * Pure view-model for the package workbench. Families come only from the engine's `families` chains,
 * so no NuGet family matching is reimplemented here. Loaded in the webview and by node tests.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NuGetModel = api;
})(typeof globalThis === 'object' ? globalThis : this, () => {
  const lower = (value) => String(value ?? '').toLowerCase();
  const packageKey = (row) => lower(row.packageId);
  const chainOf = (row) => (Array.isArray(row.families) && row.families.length ? row.families : [row.packageId]);
  const byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const isUpdate = (row) => row.status === 'update';
  const otherKinds = new Set(['revision', 'prerelease']);

  /** Distinct-package counts; a package counts once per status it has in any declaration. */
  function summarize(rows) {
    const count = (filter) => new Set(rows.filter(filter).map(packageKey)).size;
    return {
      packages: count(() => true),
      declarations: rows.length,
      updates: count(isUpdate),
      current: count((row) => row.status === 'current'),
      failed: count((row) => row.status === 'error'),
      checking: count((row) => row.status === 'checking'),
      unchecked: count((row) => row.status === 'unchecked'),
    };
  }

  /** View filters: text query, declaring file, update kinds ('other' = revision/prerelease) and a family name. */
  function filterRows(rows, filters = {}) {
    const query = lower(filters.query).trim();
    const kinds = new Set(filters.kinds ?? []);
    const family = lower(filters.family);
    return rows.filter(
      (row) =>
        (!query || lower(row.packageId).includes(query) || lower(row.fileLabel).includes(query)) &&
        (!filters.file || row.file === filters.file) &&
        (!kinds.size || kinds.has(otherKinds.has(row.updateKind) ? 'other' : row.updateKind)) &&
        (!family || chainOf(row).some((name) => lower(name) === family)),
    );
  }

  function packageNode(entry, parent) {
    const rows = entry.rows.slice().sort((a, b) => a.fileLabel.localeCompare(b.fileLabel) || a.start - b.start);
    return { type: 'package', id: `p:${lower(entry.name)}`, name: entry.name, parent, count: 1, rows };
  }

  function onlyPackage(node) {
    while (!node.ends.length) node = node.children.values().next().value;
    return node.ends[0];
  }

  function emit(node, parent) {
    const out = node.ends.map((entry) => packageNode(entry, parent));
    for (const child of node.children.values()) {
      if (child.count === 1) {
        out.push(packageNode(onlyPackage(child), parent));
        continue;
      }
      let group = child;
      // A prefix holding exactly the same packages as its only child adds no choice: fold it.
      while (!group.ends.length && group.children.size === 1) group = group.children.values().next().value;
      const children = emit(group, group.name);
      out.push({
        type: 'group',
        id: `g:${group.key}`,
        name: group.name,
        parent,
        count: group.count,
        children,
        rows: children.flatMap((item) => item.rows),
      });
    }
    return out.sort(byName);
  }

  /**
   * Family tree for the given rows. A family node exists only when it groups two or more packages;
   * single-package families are plain package nodes. Declarations of one package share one node.
   */
  function buildTree(rows) {
    const packages = new Map();
    for (const row of rows) {
      const id = packageKey(row);
      if (!packages.has(id)) packages.set(id, { name: row.packageId, rows: [], chain: chainOf(row) });
      packages.get(id).rows.push(row);
    }
    const root = { key: '', name: '', children: new Map(), ends: [], count: 0 };
    for (const entry of packages.values()) {
      let node = root;
      node.count++;
      for (const name of entry.chain) {
        const key = lower(name);
        if (!node.children.has(key)) node.children.set(key, { key, name, children: new Map(), ends: [], count: 0 });
        node = node.children.get(key);
        node.count++;
      }
      node.ends.push(entry);
    }
    return emit(root, '');
  }

  /** Family navigation: group nodes only, nested. */
  function familyNav(rows) {
    const strip = (nodes) =>
      nodes
        .filter((node) => node.type === 'group')
        .map((node) => ({
          type: 'group',
          id: node.id,
          name: node.name,
          parent: node.parent,
          count: node.count,
          children: strip(node.children),
        }));
    return strip(buildTree(rows));
  }

  /** Visit nodes depth-first; `open(node)` decides whether a group's children are visited. */
  function walk(nodes, visit, open = () => true, depth = 0, parentId = '') {
    for (const node of nodes) {
      visit(node, depth, parentId);
      if (node.type === 'group' && open(node)) walk(node.children, visit, open, depth + 1, node.id);
    }
  }

  /** Every package node in name order, regardless of family: the flat List view. */
  function packageList(rows) {
    const nodes = [];
    walk(buildTree(rows), (node) => node.type === 'package' && nodes.push(node));
    return nodes.sort(byName);
  }

  /**
   * Groups-first view: each top-level family is one group whose nested families become flat subgroups
   * and whose packages are listed in name order. Packages outside any family share the `g:*` group.
   * Groups come from `rows`; when `shown` is given, filters only hide rows inside those stable groups.
   */
  function groupView(rows, shown) {
    const groups = [];
    const others = [];
    for (const node of buildTree(rows)) {
      if (node.type !== 'group') {
        others.push(node);
        continue;
      }
      const subgroups = [];
      const packages = [];
      walk(node.children, (child) =>
        child.type === 'group'
          ? subgroups.push({ id: child.id, name: child.name, count: child.count, rows: child.rows })
          : packages.push(child),
      );
      groups.push({
        id: node.id,
        name: node.name,
        count: node.count,
        rows: node.rows,
        subgroups,
        packages: packages.sort(byName),
      });
    }
    if (others.length)
      groups.push({
        id: 'g:*',
        name: '',
        other: true,
        count: others.length,
        rows: others.flatMap((node) => node.rows),
        subgroups: [],
        packages: others.sort(byName),
      });
    return shown ? narrow(groups, new Set(shown.map((row) => row.key))) : groups;
  }

  /** Keep only shown rows; drop empty packages, groups and subgroups that no longer narrow the group. */
  function narrow(groups, keys) {
    const keep = (list) => list.filter((row) => keys.has(row.key));
    return groups.flatMap((group) => {
      const packages = group.packages
        .map((node) => ({ ...node, rows: keep(node.rows) }))
        .filter((node) => node.rows.length);
      if (!packages.length) return [];
      const subgroups = group.subgroups
        .map((sub) => {
          const subRows = keep(sub.rows);
          return { ...sub, rows: subRows, count: new Set(subRows.map(packageKey)).size };
        })
        .filter((sub) => sub.count >= 2 && sub.count < packages.length);
      return [{ ...group, count: packages.length, rows: packages.flatMap((node) => node.rows), subgroups, packages }];
    });
  }

  /** Declaration keys of a node, optionally only those with an available update. */
  function collectKeys(node, updatesOnly = true) {
    return (node.rows ?? []).filter((row) => !updatesOnly || isUpdate(row)).map((row) => row.key);
  }

  /** Tri-state checkbox value for a set of selectable keys. */
  function selectionState(keys, selected) {
    if (!keys.length) return 'none';
    const chosen = keys.filter((key) => selected.has(key)).length;
    return chosen === 0 ? 'none' : chosen === keys.length ? 'all' : 'some';
  }

  /** Split `to` into the part shared with `from` and the changed tail, at dot, dash or plus boundaries. */
  function versionDiff(from, to) {
    const source = String(from ?? '').split(/([.+-])/);
    const target = String(to ?? '').split(/([.+-])/);
    let index = 0;
    while (index < target.length && index < source.length && target[index] === source[index]) index++;
    if (index === target.length) return { same: String(to ?? ''), changed: '' };
    if (index % 2 === 1 && index >= source.length) index++;
    return { same: target.slice(0, index).join(''), changed: target.slice(index).join('') };
  }

  return {
    summarize,
    filterRows,
    buildTree,
    familyNav,
    walk,
    packageList,
    groupView,
    collectKeys,
    selectionState,
    versionDiff,
  };
});
