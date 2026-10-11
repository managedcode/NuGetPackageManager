import * as vscode from 'vscode';
import type { PlannedChange } from '../Contracts/types';

/** Save changed clean files using the current models, preserving pre-existing unsaved buffers. */
export async function saveUpdatedDocuments(plan: PlannedChange[], dirty: Set<string>): Promise<void> {
  const files = [...new Set(plan.map((change) => change.file))].filter((file) => !dirty.has(file));
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(file));
      if (!(await document.save())) throw new Error('VS Code could not save the updated file.');
    }),
  );
  if (results.some((result) => result.status === 'rejected'))
    throw new Error(
      'Updates were applied to editor buffers, but some files could not be saved. Save those files manually.',
    );
}
