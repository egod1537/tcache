import { describe, expect, it } from 'vitest';
import {
  createRawArtifactManifest,
  discoverEdition,
  discoverYamanoteSources,
  type CollectedResponse,
} from '../index.js';

const html = `
  <script>announce_INIT('../','2610','index',0,0,0,'JRデータの内容は「JR時刻表」明示ラベル号に基づいています。');</script>
  <table>
    <tr><th>山手線</th><td>品川方面 (外回り)</td>
      <td class="weekday"><a href="/2610/timetable/outer-weekday.html">平日</a></td>
      <td class="holiday"><a href="/2610/timetable/outer-holiday.html">土曜・休日</a></td>
      <td class="weekday"><a href="/2610/timetable-v/outer-weekday.html">平日</a></td>
      <td class="holiday"><a href="/2610/timetable-v/outer-holiday.html">土曜・休日</a></td>
    </tr>
    <tr><th>山手線</th><td>上野方面 (内回り)</td>
      <td class="weekday"><a href="/2610/timetable/inner-weekday.html">平日</a></td>
      <td class="holiday"><a href="/2610/timetable/inner-holiday.html">土曜・休日</a></td>
      <td class="weekday"><a href="/2610/timetable-v/inner-weekday.html">平日</a></td>
      <td class="holiday"><a href="/2610/timetable-v/inner-holiday.html">土曜・休日</a></td>
    </tr>
  </table>`;

describe('JR East source discovery', () => {
  it('keeps the observed edition key separate from an explicit label', () => {
    const edition = discoverEdition(html, 'https://timetables.jreast.co.jp/');
    expect(edition).toMatchObject({
      observedRawEditionKey: '2610',
      humanReadableLabel: '明示ラベル号',
    });

    const response: CollectedResponse = {
      request: {
        sourceUrl: 'https://timetables.jreast.co.jp/timetable/list1039.html',
        sourceEdition: '2610',
        sourceType: 'station-index-html',
        operator: 'jr-east',
      },
      requestedAt: '2026-09-27T03:00:00Z',
      httpStatus: 200,
      contentType: 'text/html',
      body: new TextEncoder().encode(html),
    };
    const discovery = discoverYamanoteSources(
      html,
      createRawArtifactManifest(response, 'fixture/1.0.0'),
      edition,
    );
    expect(discovery.sources).toHaveLength(4);
    expect(discovery.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ direction: 'outer', service: 'weekday' }),
        expect.objectContaining({ direction: 'inner', service: 'holiday' }),
      ]),
    );
  });
});
