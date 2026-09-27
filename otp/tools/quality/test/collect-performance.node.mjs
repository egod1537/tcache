import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildPerformanceMetrics } from '../collect-performance.mjs';

test('collects reproducible graph, runtime, memory, and query percentiles', () => {
  const metrics = buildPerformanceMetrics({
    buildId: 'candidate',
    build: {
      graphBytes: 1234,
      graphSha256: 'abc',
      durationSeconds: 90,
      approximatePeakMemoryMiB: 512.5,
    },
    runtime: {
      startupDurationSeconds: 12,
      idleMemoryObserved: '1.5GiB / 8GiB',
    },
    smoke: {
      results: [10, 20, 30, 40, 100].map((queryLatencyMs) => ({
        queryLatencyMs,
      })),
    },
    baseline: {
      buildId: 'baseline',
      graph: { bytes: 1000 },
      build: { durationSeconds: 80, approximatePeakMemoryMiB: 500 },
      startup: { durationSeconds: 10, idleMemoryMiB: 1024 },
      routingQueries: {
        p50Milliseconds: 25,
        p95Milliseconds: 90,
        maxMilliseconds: 90,
      },
    },
  });

  assert.equal(metrics.graph.bytes, 1234);
  assert.equal(metrics.startup.idleMemoryMiB, 1536);
  assert.deepEqual(metrics.routingQueries, {
    count: 5,
    p50Milliseconds: 30,
    p95Milliseconds: 100,
    maxMilliseconds: 100,
  });
  assert.equal(metrics.baseline.deltas.graphBytes, 234);
  assert.equal(metrics.baseline.deltas.queryP95Milliseconds, 10);
});

test('fails closed when a smoke result has no measured latency', () => {
  assert.throws(
    () =>
      buildPerformanceMetrics({
        buildId: 'candidate',
        build: {},
        runtime: {},
        smoke: { results: [{ queryLatencyMs: 10 }, {}] },
      }),
    /Query latency is missing/,
  );
});

test('does not coerce missing measurements into zero', () => {
  const metrics = buildPerformanceMetrics({
    buildId: 'candidate',
    build: {},
    runtime: {},
    smoke: { results: [] },
  });
  assert.equal(metrics.graph.bytes, null);
  assert.equal(metrics.build.durationSeconds, null);
  assert.equal(metrics.startup.durationSeconds, null);
});
