import type { DatabaseSync } from 'node:sqlite'

export const migrationNamespace = 'application.prompt-resource'

export function migrateVersionOne(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE prompt_resources (
      id TEXT PRIMARY KEY,
      resource_kind TEXT NOT NULL CHECK (resource_kind IN ('preset', 'setting', 'logic', 'runtime', 'history', 'prompt')),
      root_node_id TEXT NOT NULL,
      label TEXT NOT NULL,
      version INTEGER NOT NULL CHECK (version > 0),
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      tombstoned INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_json TEXT,
      delete_reason TEXT
    );

    CREATE TABLE prompt_resource_nodes (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      parent_id TEXT,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('module', 'folder', 'entry', 'script', 'virtual', 'order')),
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
      FOREIGN KEY(resource_id, parent_id) REFERENCES prompt_resource_nodes(resource_id, id)
    );

    CREATE TABLE global_setting_mounts (
      id TEXT PRIMARY KEY,
      setting_resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'preset')),
      source_id TEXT NOT NULL,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      origin_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(setting_resource_id, source_kind, source_id)
    );

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

    CREATE UNIQUE INDEX idx_prompt_resource_one_root
      ON prompt_resource_nodes(resource_id) WHERE parent_id IS NULL;
    CREATE INDEX idx_prompt_resources_kind_label ON prompt_resources(resource_kind, label);
    CREATE INDEX idx_prompt_resource_nodes_parent_order ON prompt_resource_nodes(resource_id, parent_id, order_index, id);
    CREATE INDEX idx_prompt_resource_nodes_kind ON prompt_resource_nodes(resource_id, kind);
    CREATE INDEX idx_global_setting_mounts_source ON global_setting_mounts(source_kind, source_id, order_index, id);
    CREATE INDEX idx_global_setting_mounts_setting ON global_setting_mounts(setting_resource_id);
    CREATE INDEX idx_prompt_resource_revisions_changeset ON prompt_resource_node_revisions(changeset_id);
    CREATE INDEX idx_prompt_resource_header_revisions_changeset ON prompt_resource_header_revisions(changeset_id);
  `)
}

export function migrateVersionTwo(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE preset_tool_mounts (
      id TEXT PRIMARY KEY,
      preset_resource_id TEXT NOT NULL REFERENCES prompt_resources(id),
      tool_id TEXT NOT NULL,
      order_index INTEGER NOT NULL CHECK (order_index >= 0),
      default_enabled INTEGER NOT NULL CHECK (default_enabled IN (0, 1)),
      activation_json TEXT,
      provider_order REAL,
      content_zone TEXT,
      content_slot TEXT,
      content_rank_key TEXT,
      content_order_hint REAL,
      origin_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(preset_resource_id, tool_id)
    );

    CREATE INDEX idx_preset_tool_mounts_preset
      ON preset_tool_mounts(preset_resource_id, order_index, id);
    CREATE INDEX idx_preset_tool_mounts_tool ON preset_tool_mounts(tool_id);
  `)
}
