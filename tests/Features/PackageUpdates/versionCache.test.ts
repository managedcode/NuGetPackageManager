import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { test } from 'node:test';
import type { Feed } from '../../../src/Features/PackageUpdates/Contracts/types';
import { VersionCache } from '../../../src/Features/PackageUpdates/Host/versionCache';

// REQ-010 / AC-014: automatic checks reuse successful listed versions for at most 10 minutes per feed set, explicit
// checks refetch, failed or cancelled lookups are never cached, and the reported time is when the data was fetched.

const minute = 60_000;
const sample = 'Sample.Package';
const feeds: Feed[] = [{ name: 'Local NuGet V3', url: 'http://127.0.0.1:5000/v3/index.json' }];

/** Controllable clock injected into the cache. */
function clock(start = Date.UTC(2026, 9, 8, 12)) {
  let current = start;
  return {
    start,
    now: () => current,
    advance(milliseconds: number) {
      current += milliseconds;
    },
  };
}

/** A real asynchronous listing function that counts how often the feed was queried. */
function listing(...versions: string[]) {
  const queries = { count: 0 };
  const list = async (): Promise<string[]> => {
    queries.count++;
    await new Promise((resolve) => setImmediate(resolve));
    return [...versions];
  };
  return { queries, list };
}

const unavailable = async (): Promise<string[]> => {
  await new Promise((resolve) => setImmediate(resolve));
  throw new Error('Feed unavailable');
};

test('get returns a copy of the listing for up to ten minutes and reports when it was fetched', () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  assert.equal(cache.get(sample, feeds), undefined);
  cache.set(sample, feeds, ['1.0.0', '2.0.0']);
  time.advance(5 * minute);
  assert.deepEqual(cache.get(sample, feeds), { versions: ['1.0.0', '2.0.0'], at: time.start });
  time.advance(5 * minute);
  assert.deepEqual(
    cache.get(sample, feeds),
    { versions: ['1.0.0', '2.0.0'], at: time.start },
    'ten minutes is still fresh',
  );
  assert.equal(cache.get('Other.Package', feeds), undefined);
  time.advance(1);
  assert.equal(cache.get(sample, feeds), undefined, 'older than ten minutes must expire');
});

test('an entry stored with an explicit data time expires relative to that time', () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  cache.set(sample, feeds, ['1.0.0'], time.start - 9 * minute);
  assert.deepEqual(cache.get(sample, feeds), { versions: ['1.0.0'], at: time.start - 9 * minute });
  time.advance(minute + 1);
  assert.equal(cache.get(sample, feeds), undefined);
});

test('a different feed set clears every entry by name, by URL and by an added source', async () => {
  const [first] = feeds;
  const changes: Feed[][] = [
    [{ ...first, name: 'Renamed feed' }],
    [{ ...first, url: 'http://127.0.0.1:5001/v3/index.json' }],
    [...feeds, { name: 'Second feed', url: 'http://127.0.0.1:5002/v3/index.json' }],
  ];
  for (const changed of changes) {
    const cache = new VersionCache(clock().now);
    cache.set(sample, feeds, ['1.0.0']);
    cache.set('Other.Package', feeds, ['3.0.0']);
    assert.ok(cache.get(sample, feeds));
    assert.equal(cache.get(sample, changed), undefined, `${JSON.stringify(changed)} must not reuse entries`);
    assert.equal(cache.get(sample, feeds), undefined, 'returning to the old feed set must not bring entries back');
    assert.equal(cache.get('Other.Package', feeds), undefined);
  }

  const cache = new VersionCache(clock().now);
  cache.set('Old.Package', feeds, ['1.0.0']);
  cache.set('New.Package', changes[0], ['2.0.0']);
  assert.equal(cache.get('Old.Package', changes[0]), undefined, 'storing under a new feed set drops the old entries');
  assert.deepEqual(cache.get('New.Package', changes[0])?.versions, ['2.0.0']);

  const feed = listing('1.0.0');
  await cache.lookup(sample, changes[0], false, feed.list);
  await cache.lookup(sample, changes[1], false, feed.list);
  assert.equal(feed.queries.count, 2, 'an automatic lookup under a changed feed set must query the feeds');
});

test('package IDs are case-insensitive', async () => {
  const cache = new VersionCache(clock().now);
  cache.set('Newtonsoft.Json', feeds, ['13.0.1']);
  assert.deepEqual(cache.get('NEWTONSOFT.JSON', feeds)?.versions, ['13.0.1']);
  cache.set('newtonsoft.JSON', feeds, ['13.0.3']);
  assert.deepEqual(cache.get('Newtonsoft.Json', feeds)?.versions, ['13.0.3']);

  const feed = listing('9.9.9');
  assert.deepEqual((await cache.lookup('newtonsoft.json', feeds, false, feed.list)).versions, ['13.0.3']);
  assert.equal(feed.queries.count, 0);
});

test('lookup fetches once, then reuses the entry without querying and keeps the original data time', async () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  const feed = listing('1.0.0', '2.0.0');
  assert.deepEqual(await cache.lookup(sample, feeds, false, feed.list), {
    versions: ['1.0.0', '2.0.0'],
    at: time.start,
  });
  time.advance(7 * minute);
  const reused = await cache.lookup('SAMPLE.PACKAGE', feeds, false, feed.list);
  assert.equal(feed.queries.count, 1, 'a fresh entry must be served without a feed query');
  assert.deepEqual(reused, { versions: ['1.0.0', '2.0.0'], at: time.start }, 'the check time must not look newer');
});

test('lookup queries again after expiry and stores the newer data time', async () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  const feed = listing('1.0.0');
  await cache.lookup(sample, feeds, false, feed.list);
  time.advance(10 * minute + 1);
  assert.deepEqual(await cache.lookup(sample, feeds, false, feed.list), {
    versions: ['1.0.0'],
    at: time.start + 10 * minute + 1,
  });
  assert.equal(feed.queries.count, 2);
  await cache.lookup(sample, feeds, false, feed.list);
  assert.equal(feed.queries.count, 2, 'the refreshed entry is fresh again');
});

test('lookup with fresh=true always queries the feeds and replaces the stored entry', async () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  await cache.lookup(sample, feeds, false, listing('1.0.0').list);
  time.advance(2 * minute);
  const explicit = listing('1.0.0', '2.0.0');
  assert.deepEqual(await cache.lookup(sample, feeds, true, explicit.list), {
    versions: ['1.0.0', '2.0.0'],
    at: time.start + 2 * minute,
  });
  assert.equal(explicit.queries.count, 1, 'an explicit check must not be answered from a fresh entry');

  const automatic = listing('9.9.9');
  assert.deepEqual((await cache.lookup(sample, feeds, false, automatic.list)).versions, ['1.0.0', '2.0.0']);
  assert.equal(automatic.queries.count, 0, 'the explicit result is what the next automatic check reuses');

  const empty = new VersionCache(time.now);
  await empty.lookup(sample, feeds, true, explicit.list);
  assert.equal(explicit.queries.count, 2);
  assert.deepEqual(empty.get(sample, feeds)?.versions, ['1.0.0', '2.0.0'], 'an explicit lookup stores its result');
});

test('lookup stamps the time the query started, not the time it finished', async () => {
  const time = clock();
  const cache = new VersionCache(time.now);
  const slow = async (): Promise<string[]> => {
    time.advance(3 * minute);
    return ['1.0.0'];
  };
  assert.deepEqual(await cache.lookup(sample, feeds, false, slow), { versions: ['1.0.0'], at: time.start });
  assert.equal(cache.get(sample, feeds)?.at, time.start);
});

test('a rejected or cancelled query propagates and stores nothing', async () => {
  const cache = new VersionCache(clock().now);
  await assert.rejects(cache.lookup(sample, feeds, false, unavailable), /Feed unavailable/);
  await assert.rejects(cache.lookup(sample, feeds, true, unavailable), /Feed unavailable/);
  assert.equal(cache.get(sample, feeds), undefined);

  const controller = new AbortController();
  const cancellable = () =>
    new Promise<string[]>((_, reject) =>
      controller.signal.addEventListener('abort', () => reject(controller.signal.reason)),
    );
  const pending = cache.lookup(sample, feeds, false, cancellable);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cache.get(sample, feeds), undefined);

  const feed = listing('1.0.0');
  await cache.lookup(sample, feeds, false, feed.list);
  assert.equal(feed.queries.count, 1, 'a later lookup must query again because the failures were not cached');
  await cache.lookup(sample, feeds, false, feed.list);
  assert.equal(feed.queries.count, 1);
});

test('stored and returned version arrays are copies', async () => {
  const cache = new VersionCache(clock().now);
  const source = ['1.0.0', '2.0.0'];
  cache.set(sample, feeds, source);
  source.push('3.0.0');
  const stored = cache.get(sample, feeds);
  assert.ok(stored);
  assert.deepEqual(stored.versions, ['1.0.0', '2.0.0'], 'later edits of the caller array must not reach the cache');
  stored.versions.length = 0;
  assert.deepEqual(
    cache.get(sample, feeds)?.versions,
    ['1.0.0', '2.0.0'],
    'edits of a returned copy must not reach it',
  );

  const queried = await cache.lookup('Other.Package', feeds, false, listing('1.0.0').list);
  queried.versions.push('9.9.9');
  assert.deepEqual(cache.get('Other.Package', feeds)?.versions, ['1.0.0'], 'a queried result is stored as a copy');

  const reused = await cache.lookup(sample, feeds, false, listing('8.8.8').list);
  reused.versions.push('9.9.9');
  assert.deepEqual(cache.get(sample, feeds)?.versions, ['1.0.0', '2.0.0'], 'a cache hit hands out a copy');
});

test('clear removes every entry so the next lookup queries the feeds', async () => {
  const cache = new VersionCache(clock().now);
  const feed = listing('1.0.0');
  await cache.lookup(sample, feeds, false, feed.list);
  cache.clear();
  assert.equal(cache.get(sample, feeds), undefined);
  await cache.lookup(sample, feeds, false, feed.list);
  assert.equal(feed.queries.count, 2);
});

test('without an injected clock entries are dated by the wall clock', () => {
  const cache = new VersionCache();
  const before = Date.now();
  cache.set(sample, feeds, ['1.0.0']);
  const stored = cache.get(sample, feeds);
  assert.ok(stored && stored.at >= before && stored.at <= Date.now());
});

test('against a real HTTP feed automatic checks reuse listings, explicit checks refetch and failures are never cached', async (t) => {
  const requests: string[] = [];
  let failing = false;
  const server = createServer((request, response) => {
    const id = decodeURIComponent(request.url?.split('/').pop() ?? '');
    requests.push(id);
    response.setHeader('connection', 'close');
    if (failing) {
      response.writeHead(503).end();
      return;
    }
    const count = requests.filter((item) => item === id).length;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ versions: ['1.0.0', `2.${count}.0`] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const origin = `http://127.0.0.1:${address.port}`;
  const sources: Feed[] = [{ name: 'Local feed', url: `${origin}/v3/index.json` }];
  const queryFeed = (id: string) => async (): Promise<string[]> => {
    const response = await fetch(`${origin}/flat/${id.toLowerCase()}`);
    if (!response.ok) throw new Error(`Feed returned ${response.status}`);
    return ((await response.json()) as { versions: string[] }).versions;
  };
  const time = clock();
  const cache = new VersionCache(time.now);
  const automatic = async (id: string) => (await cache.lookup(id, sources, false, queryFeed(id))).versions;
  const explicit = async (id: string) => (await cache.lookup(id, sources, true, queryFeed(id))).versions;
  const requested = (id: string) => requests.filter((item) => item === id.toLowerCase()).length;

  assert.deepEqual(await automatic(sample), ['1.0.0', '2.1.0']);
  time.advance(9 * minute);
  assert.deepEqual(await automatic('SAMPLE.PACKAGE'), ['1.0.0', '2.1.0']);
  assert.equal(requested(sample), 1, 'a cached listing must not touch the feed');
  assert.deepEqual(await explicit(sample), ['1.0.0', '2.2.0']);
  assert.equal(requested(sample), 2);
  time.advance(10 * minute);
  assert.deepEqual(await automatic(sample), ['1.0.0', '2.2.0'], 'ten minutes after the explicit check is still fresh');
  time.advance(1);
  assert.deepEqual(await automatic(sample), ['1.0.0', '2.3.0'], 'a listing older than ten minutes is queried again');

  failing = true;
  await assert.rejects(automatic('Broken.Package'), /Feed returned 503/);
  await assert.rejects(automatic('Broken.Package'), /Feed returned 503/);
  assert.equal(requested('Broken.Package'), 2, 'a failed check must not be cached');
  failing = false;
  assert.deepEqual(await automatic('Broken.Package'), ['1.0.0', '2.3.0']);
  assert.deepEqual(await automatic('Broken.Package'), ['1.0.0', '2.3.0']);
  assert.equal(requested('Broken.Package'), 3, 'the recovered listing is cached again');
});
