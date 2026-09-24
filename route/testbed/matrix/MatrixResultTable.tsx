import { Callout, Card, Classes } from '@blueprintjs/core';

import type { MatrixResult } from '../../../apps/testbed/src/api/client';
import { SectionHeader } from '../../../apps/testbed/src/components/common/SectionHeader';
import { formatDuration } from './matrix-types';

export function MatrixResultTable({ result }: { result: MatrixResult | null }) {
  return (
    <Card className="matrix-result-card" compact>
      <SectionHeader
        title="Travel-time Matrix"
        description="Travel time is directional; A → B and B → A may differ."
      />
      {!result ? (
        <Callout compact icon="grid-view">
          Job이 완료되면 directed duration matrix가 표시됩니다.
        </Callout>
      ) : (
        <div className="matrix-table-wrap">
          <table className="bp6-html-table bp6-html-table-bordered bp6-html-table-condensed matrix-table">
            <thead>
              <tr>
                <th aria-label="From / To" />
                {result.locations.map(({ id }) => (
                  <th key={id} scope="col">
                    <code className={Classes.MONOSPACE_TEXT}>{id}</code>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.locations.map((from, fromIndex) => (
                <tr key={from.id}>
                  <th scope="row">
                    <code className={Classes.MONOSPACE_TEXT}>{from.id}</code>
                  </th>
                  {result.durationSeconds[fromIndex]?.map(
                    (seconds, toIndex) => (
                      <td
                        className={
                          fromIndex === toIndex ? 'matrix-diagonal' : ''
                        }
                        data-raw-seconds={seconds}
                        key={`${from.id}-${result.locations[toIndex]?.id}`}
                        title={`${from.id} → ${result.locations[toIndex]?.id}: ${seconds} seconds`}
                      >
                        <strong>{formatDuration(seconds)}</strong>
                        <small>{seconds}s</small>
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
