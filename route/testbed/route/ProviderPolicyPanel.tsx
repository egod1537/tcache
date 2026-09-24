import {
  Callout,
  Card,
  Classes,
  HTMLTable,
  Intent,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { useEffect, useState } from 'react';

import {
  getRouteProviderPolicy,
  type RouteProviderPolicyResponse,
} from '../../../apps/testbed/src/api/client';

export function ProviderPolicyPanel() {
  const [policy, setPolicy] = useState<RouteProviderPolicyResponse | null>(
    null,
  );
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    void getRouteProviderPolicy(controller.signal)
      .then(setPolicy)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(
            reason instanceof Error
              ? reason.message
              : 'Provider policy를 불러오지 못했습니다.',
          );
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <Card className="route-provider-policy" compact elevation={1}>
      <div className="route-playground-panel-heading">
        <div>
          <h2 className={Classes.HEADING}>Provider Policy</h2>
          <p className={Classes.TEXT_MUTED}>
            서버에서 활성화된 국가 × 이동수단 정책입니다.
          </p>
        </div>
        {policy && (
          <Tag
            intent={
              policy.routeProviderMode === 'auto'
                ? Intent.PRIMARY
                : Intent.WARNING
            }
          >
            {policy.routeProviderMode}
          </Tag>
        )}
      </div>
      {error ? (
        <Callout compact intent={Intent.DANGER} title="Policy 조회 실패">
          {error}
        </Callout>
      ) : !policy ? (
        <div className="route-tool-loading">
          <Spinner size={20} /> 정책을 불러오는 중…
        </div>
      ) : (
        <>
          <div className="route-provider-policy-meta">
            <Tag minimal>source: {policy.policySource}</Tag>
            <Tag minimal>
              request override:{' '}
              {policy.providerOverrideEnabled ? 'enabled' : 'disabled'}
            </Tag>
            {policy.legacyCompatibilityApplied && (
              <Tag intent={Intent.WARNING}>legacy compatibility applied</Tag>
            )}
          </div>
          <div className="route-cache-table-wrap">
            <HTMLTable compact striped>
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Mode</th>
                  <th>Provider</th>
                  <th>Source</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {policy.assignments.map((assignment, index) => (
                  <tr
                    key={`${assignment.countryCode}-${assignment.mode}-${assignment.source}-${index}`}
                  >
                    <td>{assignment.countryCode ?? '*'}</td>
                    <td>{assignment.mode ?? '*'}</td>
                    <td>{assignment.provider}</td>
                    <td>{assignment.source}</td>
                    <td title={assignment.unavailableReason}>
                      <Tag
                        intent={
                          assignment.available ? Intent.SUCCESS : Intent.DANGER
                        }
                        minimal
                      >
                        {assignment.available ? 'available' : 'unavailable'}
                      </Tag>
                    </td>
                  </tr>
                ))}
              </tbody>
            </HTMLTable>
          </div>
        </>
      )}
    </Card>
  );
}
