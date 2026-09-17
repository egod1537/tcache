import {
  Button,
  Callout,
  Card,
  Classes,
  HTMLTable,
  InputGroup,
  Intent,
  NonIdealState,
  Spinner,
  Tag,
} from '@blueprintjs/core';
import { useEffect, useMemo, useState } from 'react';

import {
  getRouteCacheEntry,
  listRouteCacheEntries,
  type RouteCacheEntry,
  type RouteCacheEntrySummary,
} from '../../../apps/testbed/src/api/client';
import { JsonViewer } from '../../../apps/testbed/src/components/common/JsonViewer';

export function RouteCacheExplorerPage() {
  const [entries, setEntries] = useState<RouteCacheEntrySummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<RouteCacheEntry | null>(
    null,
  );
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [entryLoading, setEntryLoading] = useState(false);
  const [error, setError] = useState('');

  const filteredEntries = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(
      (entry) =>
        entry.key.toLowerCase().includes(query) ||
        entry.provider?.toLowerCase().includes(query),
    );
  }, [entries, filter]);

  async function load(signal?: AbortSignal) {
    setLoading(true);
    setError('');
    try {
      const nextEntries = await listRouteCacheEntries(100, signal);
      setEntries(nextEntries);
      if (selectedKey) {
        const stillExists = nextEntries.some(
          (entry) => entry.key === selectedKey,
        );
        if (stillExists) {
          setSelectedEntry(await getRouteCacheEntry(selectedKey, signal));
        } else {
          setSelectedKey(null);
          setSelectedEntry(null);
        }
      }
    } catch (loadError) {
      if (signal?.aborted) return;
      setError(
        loadError instanceof Error
          ? loadError.message
          : '경로 캐시 항목을 불러오지 못했습니다.',
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, []);

  async function select(entry: RouteCacheEntrySummary) {
    setSelectedKey(entry.key);
    setEntryLoading(true);
    setError('');
    try {
      setSelectedEntry(await getRouteCacheEntry(entry.key));
    } catch (loadError) {
      setSelectedEntry(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : '경로 캐시 항목을 불러오지 못했습니다.',
      );
    } finally {
      setEntryLoading(false);
    }
  }

  return (
    <main className="route-tool-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>경로 캐시 탐색기</h1>
          <p className={Classes.TEXT_MUTED}>
            Redis 경로 캐시의 키, TTL과 Provider 결과를 확인합니다.
          </p>
        </div>
        <Button icon="refresh" loading={loading} onClick={() => void load()}>
          새로고침
        </Button>
      </div>

      <Callout compact icon="database" intent={Intent.PRIMARY}>
        이 화면은 읽기 전용입니다. PostgreSQL 분석 이력과 Redis 캐시 값은 별도로
        보관됩니다.
      </Callout>

      {error && (
        <Callout intent={Intent.DANGER} title="캐시 요청 실패">
          {error}
        </Callout>
      )}

      <div className="route-cache-explorer-grid">
        <Card className="route-cache-list" compact>
          <InputGroup
            aria-label="캐시 항목 필터"
            leftIcon="filter"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="키 또는 Provider로 필터"
            type="search"
            value={filter}
          />
          {loading && entries.length === 0 ? (
            <div className="route-tool-loading">
              <Spinner size={28} />
              Redis 키를 불러오는 중…
            </div>
          ) : filteredEntries.length === 0 ? (
            <NonIdealState
              description={
                filter
                  ? '필터와 일치하는 캐시 항목이 없습니다.'
                  : '경로 요청을 실행하면 Redis에 캐시가 저장됩니다.'
              }
              icon="database"
              title="저장된 경로 캐시가 없습니다"
            />
          ) : (
            <div className="route-cache-table-wrap">
              <HTMLTable compact interactive striped>
                <thead>
                  <tr>
                    <th>키</th>
                    <th>Provider</th>
                    <th>TTL</th>
                    <th>크기</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr
                      aria-selected={entry.key === selectedKey}
                      key={entry.key}
                      onClick={() => void select(entry)}
                    >
                      <td>
                        <code title={entry.key}>{entry.key}</code>
                      </td>
                      <td>{entry.provider ?? '—'}</td>
                      <td>{formatTtl(entry.ttlSeconds)}</td>
                      <td>{formatBytes(entry.sizeBytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </HTMLTable>
            </div>
          )}
        </Card>

        <Card className="route-cache-detail" compact>
          {entryLoading ? (
            <div className="route-tool-loading">
              <Spinner size={28} />
              캐시 항목을 불러오는 중…
            </div>
          ) : selectedEntry ? (
            <>
              <div className="route-cache-detail-heading">
                <div>
                  <h2 className={Classes.HEADING}>캐시 항목</h2>
                  <code>{selectedEntry.key}</code>
                </div>
                <Tag intent={Intent.SUCCESS}>{selectedEntry.provider}</Tag>
              </div>
              <dl className="fact-grid">
                <Fact label="TTL" value={formatTtl(selectedEntry.ttlSeconds)} />
                <Fact
                  label="크기"
                  value={formatBytes(selectedEntry.sizeBytes)}
                />
              </dl>
              <JsonViewer
                title="캐시된 Provider 결과"
                value={selectedEntry.value}
              />
            </>
          ) : (
            <NonIdealState
              description="캐시된 Provider 결과를 확인할 항목을 선택하세요."
              icon="search"
              title="캐시 항목을 선택하세요"
            />
          )}
        </Card>
      </div>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatTtl(seconds: number) {
  if (seconds < 0) return seconds === -1 ? '만료 없음' : '만료됨';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}
