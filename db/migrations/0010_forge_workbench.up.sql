CREATE TABLE forge_workbench (
  intent_id text PRIMARY KEY REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by text NOT NULL
);

CREATE INDEX forge_workbench_tenant_updated_idx
  ON forge_workbench (tenant_id, updated_at DESC);
