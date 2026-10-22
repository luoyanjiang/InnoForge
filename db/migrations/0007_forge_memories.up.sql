CREATE TABLE forge_memories (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  text text NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE', 'FORGOTTEN', 'PROMOTED')),
  consensus boolean NOT NULL DEFAULT false,
  promoted_constraint jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by text NOT NULL,
  forgotten_at timestamptz,
  promoted_at timestamptz
);

CREATE INDEX forge_memories_intent_updated_idx
  ON forge_memories (intent_id, tenant_id, updated_at DESC, id);

CREATE INDEX forge_memories_tenant_status_idx
  ON forge_memories (tenant_id, status, updated_at DESC);
