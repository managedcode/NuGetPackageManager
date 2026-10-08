import * as vscode from 'vscode';
import type { Policy } from '../Contracts/types';
import { openFeedSettings } from './navigation';

/** Controller operations a webview may request. The controller validates keys, versions and files against its state. */
export interface MessageTarget {
  ready(): Promise<void>;
  refresh(check?: boolean): Promise<void>;
  rescan(): Promise<void>;
  check(): Promise<void>;
  cancel(): void;
  setPolicy(policy: Policy, prerelease: boolean): Promise<void>;
  setTarget(key: string, version: string): Promise<void>;
  review(keys: unknown): Promise<void>;
  back(): void;
  preview(file: string): Promise<void>;
  apply(): Promise<void>;
  openDeclaration(key: string): Promise<void>;
  openPackagePage(key: string): Promise<void>;
}

const policies: readonly string[] = ['latest', 'minor', 'patch'];

/** Untrusted renderer input: only known message types with well-typed payloads reach the controller. */
export async function routeMessage(target: MessageTarget, raw: unknown): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  const message = raw as Record<string, unknown>;
  const text = (name: string) => (typeof message[name] === 'string' ? (message[name] as string) : undefined);
  const key = text('key');
  switch (message.type) {
    case 'ready':
      return target.ready();
    case 'refresh':
      return target.refresh(true);
    case 'rescan':
      return target.rescan();
    case 'check':
      return target.check();
    case 'cancel':
      return target.cancel();
    case 'policy':
      if (policies.includes(String(message.policy)) && typeof message.prerelease === 'boolean')
        return target.setPolicy(message.policy as Policy, message.prerelease);
      return;
    case 'target': {
      const version = text('version');
      if (key && version) return target.setTarget(key, version);
      return;
    }
    case 'review':
      return target.review(message.keys);
    case 'back':
      return target.back();
    case 'preview': {
      const file = text('file');
      if (file) return target.preview(file);
      return;
    }
    case 'apply':
      return target.apply();
    case 'openFile':
      if (key) return target.openDeclaration(key);
      return;
    case 'packageLink':
      if (key) return target.openPackagePage(key);
      return;
    case 'openEditor':
      await vscode.commands.executeCommand('nugetPackageManager.openEditor');
      return;
    case 'settings':
      await openFeedSettings();
      return;
    case 'openFolder':
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
      return;
    case 'manageTrust':
      await vscode.commands.executeCommand('workbench.trust.manage');
      return;
  }
}
