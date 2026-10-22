CREATE FUNCTION protect_immutable_record() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE domain_events (
  id text PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX domain_events_aggregate_order_idx
  ON domain_events (aggregate_type, aggregate_id, occurred_at, id);

CREATE TABLE outbox_messages (
  id text PRIMARY KEY,
  topic text NOT NULL,
  partition_key text NOT NULL,
  event_id text NOT NULL UNIQUE REFERENCES domain_events(id),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'CLAIMED', 'PUBLISHED')),
  created_at timestamptz NOT NULL,
  claimed_at timestamptz,
  published_at timestamptz,
  CONSTRAINT outbox_claimed_state_check CHECK (
    (status = 'PENDING' AND claimed_at IS NULL AND published_at IS NULL)
    OR (status = 'CLAIMED' AND claimed_at IS NOT NULL AND published_at IS NULL)
    OR (status = 'PUBLISHED' AND claimed_at IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE INDEX outbox_pending_order_idx
  ON outbox_messages (created_at, id)
  WHERE status = 'PENDING';
