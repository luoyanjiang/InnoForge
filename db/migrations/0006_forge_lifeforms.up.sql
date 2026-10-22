CREATE TABLE forge_lifeforms (
  id text PRIMARY KEY,
  intent_id text NOT NULL UNIQUE REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'FROZEN', 'TERMINATED')),
  proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by text NOT NULL
);

CREATE INDEX forge_lifeforms_tenant_updated_idx
  ON forge_lifeforms (tenant_id, updated_at DESC, id);

CREATE INDEX forge_lifeforms_status_idx
  ON forge_lifeforms (tenant_id, status, updated_at DESC);
