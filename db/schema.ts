import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const cloudObjects = sqliteTable(
  "cloud_objects",
  {
    path: text("path").primaryKey(),
    parentPath: text("parent_path").notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    contentType: text("content_type").notNull(),
    objectKey: text("object_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    schemaVersion: integer("schema_version"),
    revision: integer("revision").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull()
  },
  (table) => [
    index("idx_cloud_objects_parent_name").on(table.parentPath, table.name),
    index("idx_cloud_objects_kind_updated").on(table.kind, table.updatedAt)
  ]
);

export const cloudObjectHistory = sqliteTable(
  "cloud_object_history",
  {
    path: text("path").notNull(),
    revision: integer("revision").notNull(),
    objectKey: text("object_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    sha256: text("sha256").notNull(),
    transactionId: text("transaction_id"),
    createdAt: integer("created_at").notNull()
  },
  (table) => [
    primaryKey({ columns: [table.path, table.revision] }),
    index("idx_cloud_object_history_transaction").on(table.transactionId)
  ]
);

export const cloudTransactions = sqliteTable(
  "cloud_transactions",
  {
    id: text("id").primaryKey(),
    state: text("state").notNull(),
    manifestJson: text("manifest_json").notNull(),
    error: text("error"),
    createdAt: integer("created_at").notNull(),
    committedAt: integer("committed_at")
  },
  (table) => [index("idx_cloud_transactions_state_created").on(table.state, table.createdAt)]
);

export const cloudJobs = sqliteTable(
  "cloud_jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    scope: text("scope").notNull(),
    state: text("state").notNull(),
    inputJson: text("input_json").notNull(),
    progressJson: text("progress_json"),
    resultJson: text("result_json"),
    error: text("error"),
    attempt: integer("attempt").notNull().default(0),
    cancelRequested: integer("cancel_requested", { mode: "boolean" }).notNull().default(false),
    dataRevision: integer("data_revision").notNull().default(0),
    dataChangeJson: text("data_change_json"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: integer("lease_expires_at"),
    nextRunAt: integer("next_run_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    startedAt: integer("started_at"),
    finishedAt: integer("finished_at")
  },
  (table) => [
    index("idx_cloud_jobs_state_next_run").on(table.state, table.nextRunAt),
    index("idx_cloud_jobs_scope_updated").on(table.scope, table.updatedAt)
  ]
);

export const cloudJobEvents = sqliteTable(
  "cloud_job_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    jobId: text("job_id").notNull(),
    kind: text("kind").notNull(),
    payloadJson: text("payload_json").notNull(),
    createdAt: integer("created_at").notNull()
  },
  (table) => [index("idx_cloud_job_events_job_id_id").on(table.jobId, table.id)]
);
