CREATE TABLE forge_snapshots (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  statement text NOT NULL,
  constraints jsonb NOT NULL,
  frozen boolean NOT NULL,
  judgments_summary jsonb NOT NULL,
  content_hash text NOT NULL,
  pxn_task_id text,
  created_at timestamptz NOT NULL,
  created_by text NOT NULL
);

CREATE INDEX forge_snapshots_intent_created_idx
  ON forge_snapshots (intent_id, created_at DESC, id);

CREATE INDEX forge_snapshots_tenant_idx
  ON forge_snapshots (tenant_id, created_at DESC);

CREATE TRIGGER forge_snapshot_immutable BEFORE UPDATE OR DELETE ON forge_snapshots
  FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
