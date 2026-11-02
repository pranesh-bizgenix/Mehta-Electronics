CREATE TABLE IF NOT EXISTS "tenant_database_connections" (
  "tenant_id" text PRIMARY KEY NOT NULL,
  "db_url" text NOT NULL DEFAULT '',
  "db_provider" text NOT NULL DEFAULT 'shared-postgres',
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_pairing_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'tally',
  "created_by_email" text NOT NULL,
  "created_by_name" text,
  "code_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'active',
  "expires_at" timestamp with time zone NOT NULL,
  "used_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenant_connectors" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'tally',
  "installation_id" text NOT NULL,
  "machine_name" text,
  "agent_version" text,
  "status" text NOT NULL DEFAULT 'active',
  "sync_interval_seconds" integer NOT NULL DEFAULT 3600,
  "paired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "last_sync_at" timestamp with time zone,
  "last_tally_available" boolean,
  "selected_company" text,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "tenant_connectors"
  ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenant_connectors"
  ADD COLUMN IF NOT EXISTS "last_tally_available" boolean;
--> statement-breakpoint
ALTER TABLE "tenant_connectors"
  ADD COLUMN IF NOT EXISTS "selected_company" text;
--> statement-breakpoint
ALTER TABLE "tenant_connectors"
  ADD COLUMN IF NOT EXISTS "sync_interval_seconds" integer NOT NULL DEFAULT 3600;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_refresh_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "connector_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "connector_refresh_tokens_connector_id_fkey"
    FOREIGN KEY ("connector_id")
    REFERENCES "tenant_connectors" ("id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_sync_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "connector_id" text,
  "provider" text NOT NULL DEFAULT 'tally',
  "sync_id" text,
  "company_name" text,
  "company_guid" text,
  "status" text NOT NULL DEFAULT 'running',
  "record_count" integer NOT NULL DEFAULT 0,
  "message" text,
  "sync_from" date,
  "sync_to" date,
  "started_at" timestamp with time zone NOT NULL DEFAULT now(),
  "completed_at" timestamp with time zone,
  CONSTRAINT "connector_sync_jobs_connector_id_fkey"
    FOREIGN KEY ("connector_id")
    REFERENCES "tenant_connectors" ("id")
    ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_heartbeats" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "connector_id" text NOT NULL,
  "machine_name" text,
  "agent_version" text,
  "tally_available" boolean NOT NULL,
  "selected_company" text,
  "last_sync_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "connector_heartbeats_connector_id_fkey"
    FOREIGN KEY ("connector_id")
    REFERENCES "tenant_connectors" ("id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_revocations" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "connector_id" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "reason" text,
  "revoked_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "connector_revocations_connector_id_fkey"
    FOREIGN KEY ("connector_id")
    REFERENCES "tenant_connectors" ("id")
    ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "connector_audit_logs" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "connector_id" text,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "action" text NOT NULL,
  "detail" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "connector_audit_logs_connector_id_fkey"
    FOREIGN KEY ("connector_id")
    REFERENCES "tenant_connectors" ("id")
    ON DELETE SET NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connector_pairing_codes_hash_uidx"
  ON "connector_pairing_codes" ("code_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_pairing_codes_org_idx"
  ON "connector_pairing_codes" ("org_id", "provider", "created_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_connectors_installation_uidx"
  ON "tenant_connectors" ("provider", "installation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_connectors_org_idx"
  ON "tenant_connectors" ("org_id", "provider", "updated_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "connector_refresh_tokens_hash_uidx"
  ON "connector_refresh_tokens" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_refresh_tokens_connector_idx"
  ON "connector_refresh_tokens" ("connector_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_sync_jobs_org_idx"
  ON "connector_sync_jobs" ("org_id", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_sync_jobs_connector_idx"
  ON "connector_sync_jobs" ("connector_id", "started_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_heartbeats_org_idx"
  ON "connector_heartbeats" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_heartbeats_connector_idx"
  ON "connector_heartbeats" ("connector_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_revocations_org_idx"
  ON "connector_revocations" ("org_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_revocations_connector_idx"
  ON "connector_revocations" ("connector_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "connector_audit_logs_org_idx"
  ON "connector_audit_logs" ("org_id", "created_at" DESC);
