ALTER TABLE forge_intents
  ADD COLUMN IF NOT EXISTS scenario text NOT NULL DEFAULT 'PRODUCT'
    CHECK (scenario IN ('PRODUCT', 'RESEARCH', 'HARDWARE')),
  ADD COLUMN IF NOT EXISTS collab_stage text NOT NULL DEFAULT 'DRAFT'
    CHECK (collab_stage IN ('DRAFT', 'EXPLORING', 'VALIDATING', 'COMMITTED')),
  ADD COLUMN IF NOT EXISTS intent_tree jsonb NOT NULL DEFAULT '{"nodes":[],"updatedAt":null}'::jsonb;

CREATE INDEX IF NOT EXISTS forge_intents_tenant_scenario_idx
  ON forge_intents (tenant_id, scenario, updated_at DESC);
