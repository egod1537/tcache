ALTER TABLE route_requests
  ADD COLUMN country_code TEXT,
  ADD COLUMN provider_selection_source TEXT;

CREATE INDEX route_requests_country_code_idx
  ON route_requests (country_code);

CREATE INDEX route_requests_provider_selection_source_idx
  ON route_requests (provider_selection_source);
