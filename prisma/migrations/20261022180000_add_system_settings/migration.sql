-- No defaults or production setting values are inserted by this migration.
CREATE TABLE "system_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL,
    "actor_id" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "system_settings_key_check" CHECK ("key" IN ('TRUST_POLICY', 'CUSTODY_FEES')),
    CONSTRAINT "system_settings_version_check" CHECK ("version" > 0),
    CONSTRAINT "system_settings_actor_check" CHECK (length(btrim("actor_id")) > 0),
    CONSTRAINT "system_settings_value_check" CHECK (jsonb_typeof("value") = 'object')
);

CREATE TABLE "system_setting_versions" (
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "actor_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rollback_of_version" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_setting_versions_pkey" PRIMARY KEY ("key", "version"),
    CONSTRAINT "system_setting_versions_key_check" CHECK ("key" IN ('TRUST_POLICY', 'CUSTODY_FEES')),
    CONSTRAINT "system_setting_versions_version_check" CHECK ("version" > 0),
    CONSTRAINT "system_setting_versions_rollback_check" CHECK ("rollback_of_version" IS NULL OR ("rollback_of_version" > 0 AND "rollback_of_version" < "version")),
    CONSTRAINT "system_setting_versions_actor_check" CHECK (length(btrim("actor_id")) > 0),
    CONSTRAINT "system_setting_versions_reason_check" CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "system_setting_versions_value_check" CHECK (jsonb_typeof("value") = 'object')
);

-- History survives account deletion and current-setting deletion, so actor_id is
-- an immutable identifier rather than a cascading foreign key.
CREATE FUNCTION "system_setting_versions_reject_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'system setting history is append-only: % is not permitted', TG_OP
      USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "system_setting_versions_no_update_delete"
BEFORE UPDATE OR DELETE ON "system_setting_versions"
FOR EACH ROW EXECUTE FUNCTION "system_setting_versions_reject_mutation"();

CREATE TRIGGER "system_setting_versions_no_truncate"
BEFORE TRUNCATE ON "system_setting_versions"
FOR EACH STATEMENT EXECUTE FUNCTION "system_setting_versions_reject_mutation"();
