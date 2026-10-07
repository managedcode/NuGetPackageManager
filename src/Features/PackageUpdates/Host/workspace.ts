import * as vscode from 'vscode';
import type { EngineClient } from './engine';
import type { PackageRow } from '../Contracts/types';

export async function scanWorkspace(engine: EngineClient): Promise<{
  rows: PackageRow[];
  files: { uri: string; label: string; count: number }[];
  notices: string[];
  snapshots: Map<string, string>;
}> {
  const patterns = ['**/Directory.Packages.props', '**/*.csproj', '**/*.fsproj', '**/*.vbproj'];
  const groups = await Promise.all(
    patterns.map((pattern) => vscode.workspace.findFiles(pattern, '**/{bin,obj,node_modules,.git,packages}/**')),
  );
  const uris = [...new Map(groups.flat().map((uri) => [uri.toString(), uri])).values()].sort((a, b) =>
    a.fsPath.localeCompare(b.fsPath),
  );
  const rows: PackageRow[] = [];
  const files: { uri: string; label: string; count: number }[] = [];
  const notices: string[] = [];
  const snapshots = new Map<string, string>();
  for (const uri of uris) {
    const label = vscode.workspace.asRelativePath(uri, (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const id = uri.toString();
      const file = { uri: id, label, count: 0 };
      snapshots.set(id, text);
      files.push(file);
      if (text.length > 1000000) {
        notices.push(`${label}: file exceeds the 1 MB scan limit.`);
        continue;
      }
      const parsed = await engine.parse(text);
      file.count = parsed.declarations.length;
      for (const declaration of parsed.declarations) {
        rows.push({
          ...declaration,
          key: `${id}#${declaration.key}`,
          file: id,
          fileLabel: label,
          versions: [],
          status: 'unchecked',
        });
      }
      parsed.ignored.forEach((item) => notices.push(`${label} · ${item.packageId}: ${item.reason}.`));
    } catch (error) {
      notices.push(`${label}: ${error instanceof Error ? error.message : 'Could not read file'}`);
    }
  }
  rows.sort((a, b) => a.packageId.localeCompare(b.packageId) || a.fileLabel.localeCompare(b.fileLabel));
  if (!vscode.workspace.workspaceFolders?.length)
    notices.push('Open a folder or workspace to discover package declarations.');
  return { rows, files, notices, snapshots };
}
