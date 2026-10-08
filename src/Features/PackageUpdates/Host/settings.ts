import * as vscode from 'vscode';
import type { Feed } from '../Contracts/types';
import { validateFeedUrl } from './nuget';

const section = 'nugetPackageManager';

export function readFeeds(): Feed[] {
  const feeds = vscode.workspace
    .getConfiguration(section)
    .get<Feed[]>('feeds', [{ name: 'nuget.org', url: 'https://api.nuget.org/v3/index.json' }]);
  if (
    !Array.isArray(feeds) ||
    !feeds.length ||
    feeds.some((feed) => typeof feed?.name !== 'string' || !feed.name.trim() || typeof feed.url !== 'string')
  )
    throw new Error('Configure at least one NuGet V3 feed in nugetPackageManager.feeds.');
  feeds.forEach((feed) => validateFeedUrl(feed.url));
  return feeds;
}

export function readAutoCheck(): boolean {
  return vscode.workspace.getConfiguration(section).get<boolean>('autoCheck', true) !== false;
}
