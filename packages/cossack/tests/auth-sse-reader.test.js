import { expect, it } from 'vitest';
import { sseReader } from './fixtures/auth-sse-acceptance.js';

it('waits for a complete SSE event when the network splits its header and data', async () => {
  const chunks = ['event: authorization-error\n', 'data: {"code":"COSSACK_REALTIME_AUTH_CHANGED"}', '\n\n'];
  let pulls = 0;
  const reader = sseReader(new Response(new ReadableStream({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(new TextEncoder().encode(chunk));
    },
  }, { highWaterMark: 0 })));
  expect(await reader.until('event: authorization-error')).toBe(chunks.join(''));
  expect(pulls).toBe(3);
  await reader.ended(); await reader.close();
});
