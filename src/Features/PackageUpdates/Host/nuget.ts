export function validateFeedUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  ) {
    throw new Error('Feeds require HTTPS, or HTTP on localhost. Do not put credentials in a feed URL.');
  }
  return url;
}

export async function mapConcurrent<T>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(items.length, limit) }, async () => {
      while (index < items.length) {
        signal.throwIfAborted();
        const item = items[index++];
        await run(item);
      }
    }),
  );
}
