CREATE TABLE forge_judgments (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  actor_id text NOT NULL,
  candidate_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('ADOPT', 'REJECT')),
  rationale text,
  impact text,
  candidate_snapshot jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  UNIQUE (intent_id, candidate_id)
);

CREATE INDEX forge_judgments_intent_occurred_idx
  ON forge_judgments (intent_id, occurred_at DESC, id);

CREATE INDEX forge_judgments_tenant_idx
  ON forge_judgments (tenant_id, occurred_at DESC);

CREATE TRIGGER forge_judgment_immutable BEFORE UPDATE OR DELETE ON forge_judgments
  FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
