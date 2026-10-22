CREATE TABLE forge_credit_accounts (
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  balance numeric(18, 4) NOT NULL CHECK (balance >= 0),
  staked numeric(18, 4) NOT NULL CHECK (staked >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, principal_id)
);

CREATE TABLE forge_intents (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  statement text NOT NULL,
  stake numeric(18, 4) NOT NULL CHECK (stake > 0),
  status text NOT NULL CHECK (status IN (
    'DRAFT', 'STAKED', 'CONFIRMED', 'DEPLOYING', 'FEEDBACK', 'SETTLED', 'REJECTED'
  )),
  adapter_id text NOT NULL,
  pxn_task_id text,
  pxn_path jsonb,
  deploy_job_id text,
  deploy_job jsonb,
  credit_minted numeric(18, 4),
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  frozen boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  settled_at timestamptz
);

CREATE INDEX forge_intents_tenant_updated_idx
  ON forge_intents (tenant_id, updated_at DESC, id);

CREATE TABLE forge_intent_events (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  payload jsonb NOT NULL
);

CREATE INDEX forge_intent_events_order_idx
  ON forge_intent_events (intent_id, occurred_at, id);

CREATE TRIGGER forge_intent_event_immutable BEFORE UPDATE OR DELETE ON forge_intent_events
  FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
