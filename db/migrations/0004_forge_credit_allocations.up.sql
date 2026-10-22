CREATE TABLE forge_credit_allocations (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  principal_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('proposer', 'suggester', 'confirmer')),
  weight_percent numeric(8, 4) NOT NULL CHECK (weight_percent >= 0),
  amount numeric(18, 4) NOT NULL CHECK (amount >= 0),
  occurred_at timestamptz NOT NULL,
  UNIQUE (intent_id, role, principal_id)
);

CREATE INDEX forge_credit_allocations_intent_idx
  ON forge_credit_allocations (intent_id, role, principal_id);

CREATE INDEX forge_credit_allocations_tenant_idx
  ON forge_credit_allocations (tenant_id, occurred_at DESC);

CREATE TRIGGER forge_credit_allocation_immutable BEFORE UPDATE OR DELETE ON forge_credit_allocations
  FOR EACH ROW EXECUTE FUNCTION protect_immutable_record();
