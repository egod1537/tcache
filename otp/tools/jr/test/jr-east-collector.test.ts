import { describe, expect, it } from 'vitest';
import { JrEastHttpCollector } from '../index.js';

describe('JR East HTTP collector', () => {
  it('retries a bounded transient failure and logs each request attempt', async () => {
    let attempts = 0;
    const collector = new JrEastHttpCollector({
      userAgent: 'fixture-agent/1.0',
      requestDelayMs: 0,
      initialBackoffMs: 0,
      maxBackoffMs: 0,
      maxAttempts: 2,
      fetchImplementation: async () => {
        attempts += 1;
        return response(attempts === 1 ? 503 : 200, '<html>ok</html>');
      },
    });

    const result = await collector.collect({
      sourceUrl: 'https://timetables.jreast.co.jp/',
      sourceEdition: 'fixture',
      sourceType: 'fixture-html',
      operator: 'jr-east',
    });

    expect(new TextDecoder().decode(result.body)).toContain('ok');
    expect(collector.requestLog.map((entry) => entry.outcome)).toEqual([
      'RETRY',
      'SUCCESS',
    ]);
  });

  it('refuses non-official hosts before issuing a request', async () => {
    const collector = new JrEastHttpCollector({
      userAgent: 'fixture-agent/1.0',
      fetchImplementation: async () => response(200, 'unexpected'),
    });
    await expect(
      collector.collect({
        sourceUrl: 'https://example.invalid/timetable',
        sourceEdition: 'fixture',
        sourceType: 'fixture-html',
        operator: 'jr-east',
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
  });
});

function response(status: number, body: string): Response {
  const result = new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  Object.defineProperty(result, 'url', {
    value: 'https://timetables.jreast.co.jp/fixture.html',
  });
  return result;
}
