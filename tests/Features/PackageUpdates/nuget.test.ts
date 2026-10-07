import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { EngineClient } from '../../../src/Features/PackageUpdates/Host/engine';
import { mapConcurrent, validateFeedUrl } from '../../../src/Features/PackageUpdates/Host/nuget';

const engine = new EngineClient();

const registration = {
  count: 1,
  items: [
    {
      lower: 'sample.package',
      upper: 'sample.package',
      count: 4,
      items: [
        { catalogEntry: { id: 'Sample.Package', version: '1.0.0', listed: true } },
        { catalogEntry: { id: 'Sample.Package', version: '2.0.0', listed: true } },
        { catalogEntry: { id: 'Sample.Package', version: '3.0.0', listed: false } },
        { catalogEntry: { id: 'Sample.Package', version: '4.0.0-beta.1', listed: true } },
      ],
    },
  ],
};

interface FeedFixture {
  server: Server;
  url: string;
  close(): Promise<void>;
}

async function startFeed(
  options: {
    flat?: unknown;
    registration?: unknown;
    index?: unknown;
    status?: number;
    delayed?: boolean;
    trackConcurrency?: (active: number) => void;
  } = {},
): Promise<FeedFixture> {
  let activeFlat = 0;
  let origin = '';
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const flatMatch = path.match(/^\/flat\/([^/]+)\/index\.json$/);
    const registrationMatch = path.match(/^\/registration\/([^/]+)\/index\.json$/);
    if (options.delayed && flatMatch) {
      response.setHeader('content-type', 'application/json');
      const timer = setTimeout(() => response.end(JSON.stringify({ versions: ['1.0.0', '2.0.0'] })), 5000);
      response.on('close', () => clearTimeout(timer));
      return;
    }
    if (options.status && path.endsWith('/index.json')) {
      response.writeHead(options.status).end();
      return;
    }
    if (flatMatch?.[1] === 'missing.package' || registrationMatch?.[1] === 'missing.package') {
      response.writeHead(404).end();
      return;
    }
    if (flatMatch && options.trackConcurrency) {
      activeFlat++;
      options.trackConcurrency(activeFlat);
    }
    const body =
      path === '/v3/index.json'
        ? (options.index ?? {
            version: '3.0.0',
            resources: [
              { '@id': new URL('/flat/', origin).toString(), '@type': 'PackageBaseAddress/3.0.0' },
              { '@id': new URL('/registration/', origin).toString(), '@type': 'RegistrationsBaseUrl/3.6.0' },
            ],
          })
        : flatMatch
          ? (options.flat ?? { versions: ['1.0.0', '2.0.0', '3.0.0', '4.0.0-beta.1'] })
          : registrationMatch
            ? (options.registration ??
              (registrationMatch[1] === 'sample.package'
                ? registration
                : {
                    items: [
                      { items: [{ catalogEntry: { id: registrationMatch[1], version: '2.0.0', listed: true } }] },
                    ],
                  }))
            : undefined;
    if (body === undefined) {
      if (flatMatch && options.trackConcurrency) {
        activeFlat--;
        options.trackConcurrency(activeFlat);
      }
      response.writeHead(404).end();
      return;
    }
    response.setHeader('content-type', 'application/json');
    if (flatMatch && options.trackConcurrency) {
      response.once('finish', () => {
        activeFlat--;
        options.trackConcurrency?.(activeFlat);
      });
      setTimeout(() => response.end(JSON.stringify(body)), 750);
    } else response.end(JSON.stringify(body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    server,
    url: `${origin}/v3/index.json`,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

const feed = (url: string) => [{ name: 'Local NuGet V3', url }];

test('reads real NuGet V3 flat-container and listed registration metadata', async (t) => {
  const fixture = await startFeed();
  t.after(() => fixture.close());
  const versions = await engine.getVersions('Sample.Package', feed(fixture.url), new AbortController().signal);
  assert.deepEqual(versions, ['1.0.0', '2.0.0', '4.0.0-beta.1']);
});

test('reports an unknown package from real 404 protocol responses', async (t) => {
  const fixture = await startFeed();
  t.after(() => fixture.close());
  await assert.rejects(
    engine.getVersions('Missing.Package', feed(fixture.url), new AbortController().signal),
    /No listed package versions/,
  );
});

test('rejects malformed V3 index, flat versions, and registration documents', async (t) => {
  const cases = [
    { index: { resources: 'bad' } },
    { flat: { versions: ['1.0.0', 'not-a-version'] } },
    { registration: { items: [{ items: [{ catalogEntry: { version: '2.0.0' } }] }] } },
  ];
  for (const options of cases) {
    const fixture = await startFeed(options);
    try {
      await assert.rejects(engine.getVersions('Sample.Package', feed(fixture.url), new AbortController().signal));
    } finally {
      await fixture.close();
    }
  }
});

test('does not hide a failed configured source behind a healthy source', async (t) => {
  const healthy = await startFeed();
  const unavailable = await startFeed({ status: 503 });
  t.after(async () => {
    await healthy.close();
    await unavailable.close();
  });
  await assert.rejects(
    engine.getVersions(
      'Sample.Package',
      [...feed(healthy.url), { name: 'Unavailable source', url: unavailable.url }],
      new AbortController().signal,
    ),
    /Unavailable source/,
  );
});

test('reports authentication errors distinctly', async (t) => {
  const fixture = await startFeed({ status: 401 });
  t.after(() => fixture.close());
  await assert.rejects(
    engine.getVersions('Sample.Package', feed(fixture.url), new AbortController().signal),
    /requires authentication/,
  );
});

test('cancellation aborts an in-flight localhost request', async (t) => {
  const fixture = await startFeed({ delayed: true });
  t.after(() => fixture.close());
  const controller = new AbortController();
  const pending = engine.getVersions('Sample.Package', feed(fixture.url), controller.signal);
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending);
});

test('bounded package checks cap simultaneous real HTTP feed requests', async (t) => {
  let maximum = 0;
  const fixture = await startFeed({
    trackConcurrency: (active) => {
      maximum = Math.max(maximum, active);
    },
  });
  t.after(() => fixture.close());
  await mapConcurrent(
    Array.from({ length: 10 }, (_, i) => `Package${i}`),
    3,
    async (packageId) => {
      await engine.getVersions(packageId, feed(fixture.url), new AbortController().signal);
    },
    new AbortController().signal,
  );
  assert.equal(maximum, 3);
});

test('rejects remote plaintext feeds and credentials embedded in URLs', async () => {
  await assert.rejects(
    engine.getVersions('Sample.Package', [{ name: 'Remote plaintext', url: 'http://feed.example/index.json' }]),
  );
  await assert.rejects(
    engine.getVersions('Sample.Package', [
      { name: 'URL credentials', url: 'https://user:secret@feed.example/index.json' },
    ]),
  );
  await assert.rejects(engine.getVersions('Sample.Package', [{ name: 'Unsupported scheme', url: 'file:///tmp/feed' }]));
  assert.equal(validateFeedUrl('http://127.0.0.1:1234/index.json').protocol, 'http:');
});
