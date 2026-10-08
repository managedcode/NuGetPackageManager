import type { Feed } from '../Contracts/types';

const lifetimeMs = 10 * 60 * 1000;

/** Successful listed-version lookups reused by automatic checks; failures are never stored. */
export class VersionCache {
  private readonly entries = new Map<string, { versions: string[]; at: number }>();
  private feedKey = '';

  constructor(private readonly now: () => number = Date.now) {}

  get(packageId: string, feeds: Feed[]): { versions: string[]; at: number } | undefined {
    this.useFeeds(feeds);
    const entry = this.entries.get(packageId.toLowerCase());
    if (!entry || this.now() - entry.at > lifetimeMs) return undefined;
    return { versions: [...entry.versions], at: entry.at };
  }

  set(packageId: string, feeds: Feed[], versions: string[], at = this.now()): void {
    this.useFeeds(feeds);
    this.entries.set(packageId.toLowerCase(), { versions: [...versions], at });
  }

  /** Automatic checks reuse a fresh entry; otherwise fetch and remember a successful result. */
  async lookup(
    packageId: string,
    feeds: Feed[],
    fresh: boolean,
    fetch: () => Promise<string[]>,
  ): Promise<{ versions: string[]; at: number }> {
    const cached = fresh ? undefined : this.get(packageId, feeds);
    if (cached) return cached;
    const at = this.now();
    const versions = await fetch();
    this.set(packageId, feeds, versions, at);
    return { versions, at };
  }

  clear(): void {
    this.entries.clear();
  }

  private useFeeds(feeds: Feed[]): void {
    const key = JSON.stringify(feeds.map((feed) => [feed.name, feed.url]));
    if (key === this.feedKey) return;
    this.entries.clear();
    this.feedKey = key;
  }
}
