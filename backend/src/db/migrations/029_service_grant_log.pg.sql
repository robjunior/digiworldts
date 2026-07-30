CREATE TABLE IF NOT EXISTS service_grant_log (
  idempotency_key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
