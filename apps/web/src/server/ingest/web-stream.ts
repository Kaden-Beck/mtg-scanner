/**
 * `Readable.fromWeb` expects `node:stream/web`'s `ReadableStream`, which is
 * nominally distinct from lib.dom's (what `fetch`'s `Response.body` is typed
 * as) even though they're the same shape at runtime - draining the reader by
 * hand sidesteps that mismatch instead of asserting past it. Shared by every
 * job that streams a gzipped bulk file (bulk-cards.ts, price-refresh.ts).
 */
export async function* iterateWebStream(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
