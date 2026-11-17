import type { DatabaseSync } from 'node:sqlite'

export const schemaNamespace = 'application.prompt-resource'

export function initializePromptResourceSchema(database: DatabaseSync): void {
  database.exec(`
CREATE TABLE prompt_resource_node_revisions (
      resource_id TEXT NOT NULL,
      resource_version INTEGER NOT NULL,
      node_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('create', 'update', 'move', 'delete')),
      before_json TEXT,
      after_json TEXT,
      changeset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      PRIMARY KEY(resource_id, resource_version, node_id)
    );

CREATE TABLE prompt_resource_header_revisions (
      resource_id TEXT NOT NULL,
      resource_version INTEGER NOT NULL,
      before_json TEXT,
      after_json TEXT,
      changeset_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by_json TEXT NOT NULL,
      PRIMARY KEY(resource_id, resource_version)
    );

CREATE INDEX idx_prompt_resource_revisions_changeset ON prompt_resource_node_revisions(changeset_id);

CREATE INDEX idx_prompt_resource_header_revisions_changeset ON prompt_resource_header_revisions(changeset_id);

CREATE TABLE preset_tool_mounts (
      id TEXT PRIMARY KEY,
      preset_resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      tool_id TEXT NOT NULL,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      default_enabled INTEGER NOT NULL CHECK (default_enabled IN (0, 1)),
      activation_json TEXT,
      provider_order REAL,
      origin_json TEXT NOT NULL,
      created_at TEXT NOT NULL, target_anchor_id TEXT, local_depth REAL,
      UNIQUE(preset_resource_id, tool_id)
    );

CREATE INDEX idx_preset_tool_mounts_preset
      ON preset_tool_mounts(preset_resource_id, order_index, id);

CREATE INDEX idx_preset_tool_mounts_tool ON preset_tool_mounts(tool_id);

CREATE TABLE "prompt_resource_nodes" (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      parent_id TEXT,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      kind TEXT NOT NULL,
      category TEXT,
      label TEXT NOT NULL,
      meta TEXT,
      enabled INTEGER,
      body TEXT,
      capabilities_json TEXT,
      extra_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(resource_id, id),
      FOREIGN KEY(resource_id, parent_id)
        REFERENCES prompt_resource_nodes(resource_id, id)
    );

CREATE UNIQUE INDEX idx_prompt_resource_one_root
      ON prompt_resource_nodes(resource_id) WHERE parent_id IS NULL;

CREATE INDEX idx_prompt_resource_nodes_parent_order
      ON prompt_resource_nodes(resource_id, parent_id, order_index, id);

CREATE INDEX idx_prompt_resource_nodes_kind
      ON prompt_resource_nodes(resource_id, kind);

CREATE TABLE "prompt_resources" (
      id TEXT PRIMARY KEY,
      resource_kind TEXT NOT NULL,
      root_node_id TEXT NOT NULL,
      label TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_json TEXT,
      delete_reason TEXT,
      FOREIGN KEY(id, root_node_id)
        REFERENCES prompt_resource_nodes(resource_id, id)
        DEFERRABLE INITIALLY DEFERRED
    );

CREATE INDEX idx_prompt_resources_kind_label
      ON prompt_resources(resource_kind, label);

CREATE TABLE "global_lore_mounts" (
      id TEXT PRIMARY KEY,
      lore_resource_id TEXT REFERENCES prompt_resources(id),
      reference_json TEXT,
      source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'preset')),
      source_id TEXT NOT NULL,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      origin_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      CHECK (lore_resource_id IS NOT NULL OR reference_json IS NOT NULL),
      UNIQUE(lore_resource_id, source_kind, source_id)
    );

CREATE INDEX idx_global_lore_mounts_source ON global_lore_mounts(source_kind, source_id, order_index, id);

CREATE INDEX idx_global_lore_mounts_lore ON global_lore_mounts(lore_resource_id);

CREATE VIRTUAL TABLE prompt_resource_node_search USING fts5(
      label, meta, body, tokenize = 'trigram'
    );

CREATE TRIGGER prompt_resource_search_node_insert AFTER INSERT ON prompt_resource_nodes BEGIN
      INSERT INTO prompt_resource_node_search (rowid, label, meta, body)
        SELECT new.rowid, new.label, new.meta, new.body
        FROM prompt_resources r WHERE r.id = new.resource_id AND r.resource_kind IN ('lore', 'preset');
    END;

CREATE TRIGGER prompt_resource_search_node_delete AFTER DELETE ON prompt_resource_nodes BEGIN
      DELETE FROM prompt_resource_node_search WHERE rowid = old.rowid;
    END;

CREATE TRIGGER prompt_resource_search_node_update
      AFTER UPDATE OF label, meta, body, resource_id ON prompt_resource_nodes BEGIN
      DELETE FROM prompt_resource_node_search WHERE rowid = old.rowid;
      INSERT INTO prompt_resource_node_search (rowid, label, meta, body)
        SELECT new.rowid, new.label, new.meta, new.body
        FROM prompt_resources r WHERE r.id = new.resource_id AND r.resource_kind IN ('lore', 'preset');
    END;

CREATE TRIGGER prompt_resource_search_header_update
      AFTER UPDATE OF resource_kind ON prompt_resources
      WHEN old.resource_kind IS NOT new.resource_kind BEGIN
      DELETE FROM prompt_resource_node_search
        WHERE rowid IN (SELECT rowid FROM prompt_resource_nodes WHERE resource_id = new.id);
      INSERT INTO prompt_resource_node_search (rowid, label, meta, body)
        SELECT n.rowid, n.label, n.meta, n.body FROM prompt_resource_nodes n
        WHERE n.resource_id = new.id AND new.resource_kind IN ('lore', 'preset');
    END;
  `)
}

export function assertPromptResourceSchema(database: DatabaseSync): void {
  const nodeForeignKeys = database.prepare("PRAGMA foreign_key_list('prompt_resource_nodes')").all() as Array<{ table?: string; from?: string; to?: string }>
  const resourceForeignKeys = database.prepare("PRAGMA foreign_key_list('prompt_resources')").all() as Array<{ table?: string; from?: string; to?: string }>
  const hasNodeOwnerForeignKey = nodeForeignKeys.some(foreignKey =>
    foreignKey.table === 'prompt_resources'
    && foreignKey.from === 'resource_id'
    && foreignKey.to === 'id')
  const hasNodeParentForeignKey = nodeForeignKeys.some(foreignKey =>
    foreignKey.table === 'prompt_resource_nodes'
    && foreignKey.from === 'parent_id'
    && foreignKey.to === 'id')
  const hasRootForeignKey = resourceForeignKeys.some(foreignKey =>
    foreignKey.table === 'prompt_resource_nodes'
    && foreignKey.from === 'root_node_id'
    && foreignKey.to === 'id')
  if (!hasNodeOwnerForeignKey || !hasNodeParentForeignKey || !hasRootForeignKey) {
    throw new Error('Prompt Resource SQLite schema is missing required identity foreign keys')
  }
  const violations = database.prepare('PRAGMA foreign_key_check').all()
  if (violations.length > 0) {
    throw new Error(`Prompt Resource SQLite schema contains ${violations.length} foreign key violations`)
  }
}
