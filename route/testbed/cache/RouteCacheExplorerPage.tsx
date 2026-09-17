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
          : 'Failed to load Route cache entries',
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
          : 'Failed to load the Route cache entry',
      );
    } finally {
      setEntryLoading(false);
    }
  }

  return (
    <main className="route-tool-workspace">
      <div className="route-tool-heading">
        <div>
          <h1 className={Classes.HEADING}>Route Cache Explorer</h1>
          <p className={Classes.TEXT_MUTED}>
            Inspect live Redis Route Cache keys, TTLs, and provider results.
          </p>
        </div>
        <Button icon="refresh" loading={loading} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <Callout compact icon="database" intent={Intent.PRIMARY}>
        This view is read-only. PostgreSQL Analytics history is kept separately
        and cache values remain in Redis.
      </Callout>

      {error && (
        <Callout intent={Intent.DANGER} title="Cache request failed">
          {error}
        </Callout>
      )}

      <div className="route-cache-explorer-grid">
        <Card className="route-cache-list" compact>
          <InputGroup
            aria-label="Filter cache entries"
            leftIcon="filter"
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by key or provider"
            type="search"
            value={filter}
          />
          {loading && entries.length === 0 ? (
            <div className="route-tool-loading">
              <Spinner size={28} />
              Loading Redis keys…
            </div>
          ) : filteredEntries.length === 0 ? (
            <NonIdealState
              description={
                filter
                  ? 'No cache entries match this filter.'
                  : 'Run a Route request to populate Redis.'
              }
              icon="database"
              title="No Route cache entries"
            />
          ) : (
            <div className="route-cache-table-wrap">
              <HTMLTable compact interactive striped>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Provider</th>
                    <th>TTL</th>
                    <th>Size</th>
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
              Loading entry…
            </div>
          ) : selectedEntry ? (
            <>
              <div className="route-cache-detail-heading">
                <div>
                  <h2 className={Classes.HEADING}>Cache Entry</h2>
                  <code>{selectedEntry.key}</code>
                </div>
                <Tag intent={Intent.SUCCESS}>{selectedEntry.provider}</Tag>
              </div>
              <dl className="fact-grid">
                <Fact label="TTL" value={formatTtl(selectedEntry.ttlSeconds)} />
                <Fact
                  label="Size"
                  value={formatBytes(selectedEntry.sizeBytes)}
                />
              </dl>
              <JsonViewer
                title="Cached provider result"
                value={selectedEntry.value}
              />
            </>
          ) : (
            <NonIdealState
              description="Choose an entry to inspect its cached provider result."
              icon="search"
              title="Select a cache entry"
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
  if (seconds < 0) return seconds === -1 ? 'No expiry' : 'Expired';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  return `${(bytes / 1_024).toFixed(1)} KB`;
}
