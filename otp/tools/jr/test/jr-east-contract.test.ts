import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createRawArtifactManifest,
  parseNormalizedTimetable,
  type CollectedResponse,
  type JrEastParser,
  type NormalizedTimetable,
  type ParserInput,
  type RawArtifactManifest,
} from '../index.js';
import { makeValidDataset } from './fixtures.js';

class FixtureJrEastParser implements JrEastParser {
  readonly parserVersion = 'fixture-parser/1.0.0';

  supports(manifest: RawArtifactManifest): boolean {
    return (
      manifest.operator === 'jr-east' &&
      manifest.contentType.startsWith('text/html')
    );
  }

  async parse(input: ParserInput): Promise<NormalizedTimetable> {
    const html = new TextDecoder().decode(input.body);
    if (
      !html.includes('data-line-key="yamanote"') ||
      !html.includes('data-departure="23:58"')
    ) {
      throw new Error('Synthetic fixture shape changed');
    }
    return parseNormalizedTimetable(makeValidDataset());
  }
}

describe('JR East extension contract', () => {
  it('accepts a minimal synthetic HTML fixture without a web request', async () => {
    const body = await readFile(
      new URL('./fixtures/minimal-timetable.html', import.meta.url),
    );
    const response: CollectedResponse = {
      request: {
        sourceUrl: 'https://example.invalid/timetable/123.html',
        sourceEdition: '2026-09',
        sourceType: 'station-timetable-html',
        operator: 'jr-east',
      },
      requestedAt: '2026-09-27T03:00:00Z',
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
      body,
    };
    const manifest = createRawArtifactManifest(
      response,
      'fixture-collector/1.0.0',
    );
    const parser = new FixtureJrEastParser();

    expect(parser.supports(manifest)).toBe(true);
    await expect(parser.parse({ manifest, body })).resolves.toMatchObject({
      schemaVersion: '1.0',
      metadata: { operator: 'jr-east' },
    });
  });
});
