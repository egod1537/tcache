import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  JrEastPipelineError,
  JrEastTrainDetailParser,
  YamanoteMatrixParser,
  createRawArtifactManifest,
  reconcileMatrixWithDetails,
  type CollectedResponse,
} from '../index.js';

describe('Yamanote matrix parser', () => {
  it('maps columns to trips, preserves blanks/pass-through, duplicates, and midnight offsets', async () => {
    const html = await fixture('yamanote-matrix.html');
    const parsed = new YamanoteMatrixParser().parse(
      html,
      manifest(html, 'yamanote-matrix-html'),
    );

    expect(parsed.direction).toBe('outer');
    expect(parsed.service).toBe('weekday');
    expect(parsed.candidates).toHaveLength(3);
    expect(parsed.candidates[0]?.trainNumber).toBe('101G');
    expect(parsed.candidates[1]?.trainNumber).toBe('101G');
    expect(parsed.candidates[0]?.stops).toHaveLength(4);
    expect(parsed.candidates[0]?.stops[1]?.departure).toEqual({
      dayOffset: 1,
      hour: 0,
      minute: 1,
      second: 0,
    });
    expect(
      parsed.candidates[1]?.stops.map((stop) => stop.stationNameJa),
    ).toEqual(['大崎', '上野', '池袋']);
    expect(parsed.candidates[2]?.stops[1]).toMatchObject({
      stationNameJa: '上野',
      passThrough: true,
    });
    expect(parsed.candidates[2]?.stops[0]?.departure?.dayOffset).toBe(0);
  });

  it('classifies malformed HTML as a page structure change', () => {
    expect(() =>
      new YamanoteMatrixParser().parse(
        '<html><table></table></html>',
        manifest('<html><table></table></html>', 'yamanote-matrix-html'),
      ),
    ).toThrowError(JrEastPipelineError);
    try {
      new YamanoteMatrixParser().parse(
        '<html><table></table></html>',
        manifest('<html><table></table></html>', 'yamanote-matrix-html'),
      );
    } catch (error) {
      expect((error as JrEastPipelineError).code).toBe(
        'PAGE_STRUCTURE_CHANGED',
      );
    }
  });

  it('excludes unresolved through-service connector columns instead of guessing a trip', async () => {
    const html = (await fixture('yamanote-matrix.html')).replace(
      '>0001<',
      '>||<',
    );
    const parsed = new YamanoteMatrixParser().parse(
      html,
      manifest(html, 'chuo-sobu-matrix-html'),
    );

    expect(parsed.candidates).toHaveLength(2);
    expect(parsed.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'AMBIGUOUS_TRIP' }),
    );
  });
});

describe('train detail parser and conflict handling', () => {
  it('extracts arrival/departure, platform, operation condition, and calendar evidence', async () => {
    const html = await fixture('yamanote-detail.html');
    const parsed = new JrEastTrainDetailParser().parse(
      html,
      manifest(html, 'train-detail-html'),
    );

    expect(parsed.calendarStart).toBe('2026-10-01');
    expect(parsed.calendarEnd).toBe('2026-10-02');
    expect(parsed.candidates[0]?.operationConditions).toEqual(['平日運転']);
    expect(parsed.candidates[0]?.stops[1]).toMatchObject({
      stationNameJa: '東京',
      arrival: { dayOffset: 1, hour: 0, minute: 0, second: 0 },
      departure: { dayOffset: 1, hour: 0, minute: 1, second: 0 },
      platform: '４',
    });
  });

  it('reports matrix/detail differences without replacing matrix data', async () => {
    const matrixHtml = await fixture('yamanote-matrix.html');
    const detailHtml = (await fixture('yamanote-detail.html')).replace(
      '00:03 発',
      '00:04 発',
    );
    const matrix = new YamanoteMatrixParser().parse(
      matrixHtml,
      manifest(matrixHtml, 'yamanote-matrix-html'),
    );
    const detail = new JrEastTrainDetailParser().parse(
      detailHtml,
      manifest(detailHtml, 'train-detail-html'),
    );
    const result = reconcileMatrixWithDetails(
      [matrix.candidates[0]!],
      detail.candidates,
    );

    expect(result.conflicts).toHaveLength(1);
    expect(result.candidates[0]?.stops[2]?.departure?.minute).toBe(3);
  });
});

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

function manifest(html: string, sourceType: string) {
  const response: CollectedResponse = {
    request: {
      sourceUrl: `https://timetables.jreast.co.jp/2610/${sourceType}.html`,
      sourceEdition: '2610',
      sourceType,
      operator: 'jr-east',
    },
    requestedAt: '2026-09-27T03:00:00Z',
    httpStatus: 200,
    contentType: 'text/html; charset=utf-8',
    body: new TextEncoder().encode(html),
  };
  return createRawArtifactManifest(response, 'fixture-collector/1.0.0');
}
