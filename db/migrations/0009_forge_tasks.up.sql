CREATE TABLE forge_tasks (
  id text PRIMARY KEY,
  intent_id text NOT NULL REFERENCES forge_intents(id) ON DELETE RESTRICT,
  tenant_id text NOT NULL,
  tree_node_id text,
  title text NOT NULL,
  executor text NOT NULL CHECK (executor IN ('AI', 'HUMAN')),
  status text NOT NULL CHECK (status IN (
    'PENDING', 'ASSIGNED', 'IN_PROGRESS', 'REVIEW', 'DONE', 'FAILED'
  )),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  created_by text NOT NULL
);

CREATE INDEX forge_tasks_intent_updated_idx
  ON forge_tasks (intent_id, tenant_id, updated_at DESC, id);

CREATE INDEX forge_tasks_tenant_status_idx
  ON forge_tasks (tenant_id, status, updated_at DESC);
