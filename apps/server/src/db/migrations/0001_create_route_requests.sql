CREATE TABLE route_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  job_id TEXT NOT NULL UNIQUE,
  from_key TEXT NOT NULL,
  to_key TEXT NOT NULL,
  mode TEXT NOT NULL,
  day_type TEXT NOT NULL,
  time_bucket TIME NOT NULL,
  provider TEXT,
  cache_hit BOOLEAN,
  total_latency_ms INTEGER,
  provider_latency_ms INTEGER,
  status TEXT NOT NULL,
  error_code TEXT,
  cache_key TEXT,
  request_version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT route_requests_total_latency_nonnegative
    CHECK (total_latency_ms IS NULL OR total_latency_ms >= 0),
  CONSTRAINT route_requests_provider_latency_nonnegative
    CHECK (provider_latency_ms IS NULL OR provider_latency_ms >= 0),
  CONSTRAINT route_requests_request_version_positive
    CHECK (request_version > 0)
);

CREATE INDEX route_requests_created_at_idx
  ON route_requests (created_at DESC);

CREATE INDEX route_requests_mode_idx
  ON route_requests (mode);

CREATE INDEX route_requests_cache_hit_idx
  ON route_requests (cache_hit);

CREATE INDEX route_requests_provider_idx
  ON route_requests (provider);

CREATE INDEX route_requests_status_idx
  ON route_requests (status);
