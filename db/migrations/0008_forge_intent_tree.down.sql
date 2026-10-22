DROP INDEX IF EXISTS forge_intents_tenant_scenario_idx;
ALTER TABLE forge_intents
  DROP COLUMN IF EXISTS intent_tree,
  DROP COLUMN IF EXISTS collab_stage,
  DROP COLUMN IF EXISTS scenario;
