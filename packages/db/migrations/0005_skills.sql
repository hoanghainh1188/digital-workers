CREATE TYPE "public"."skill_risk" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."skill_version_status" AS ENUM('draft', 'pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."worker_skill_status" AS ENUM('active', 'pending', 'suspended');--> statement-breakpoint
CREATE TABLE "skill_blobs" (
	"company_id" uuid NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_blobs_pk" PRIMARY KEY("company_id","sha256"),
	CONSTRAINT "skill_blobs_sha256_format" CHECK ("skill_blobs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "skill_blobs_size_matches" CHECK ("skill_blobs"."size" = octet_length("skill_blobs"."content"))
);
--> statement-breakpoint
CREATE TABLE "skill_version_files" (
	"company_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"size" integer NOT NULL,
	"media_type" text NOT NULL,
	CONSTRAINT "skill_version_files_pk" PRIMARY KEY("company_id","version_id","path"),
	CONSTRAINT "skill_version_files_path_length" CHECK (char_length("skill_version_files"."path") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "skill_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "skill_version_status" DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"has_scripts" boolean DEFAULT false NOT NULL,
	"suggested_risk" "skill_risk" NOT NULL,
	"proposed_risk" "skill_risk",
	"risk" "skill_risk",
	"change_note" text,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"submitted_by_member_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"reject_reason" text,
	"ever_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_versions_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "skill_versions_company_skill_id_unique" UNIQUE("company_id","skill_id","id"),
	CONSTRAINT "skill_versions_skill_number_unique" UNIQUE("company_id","skill_id","number"),
	CONSTRAINT "skill_versions_number_positive" CHECK ("skill_versions"."number" >= 1),
	CONSTRAINT "skill_versions_description_length" CHECK (char_length("skill_versions"."description") BETWEEN 1 AND 1024),
	CONSTRAINT "skill_versions_scripts_high" CHECK (NOT "skill_versions"."has_scripts" OR ("skill_versions"."suggested_risk" = 'high' AND coalesce("skill_versions"."proposed_risk", 'high') = 'high' AND coalesce("skill_versions"."risk", 'high') = 'high')),
	CONSTRAINT "skill_versions_approved_has_risk" CHECK ("skill_versions"."status" <> 'approved' OR "skill_versions"."risk" IS NOT NULL),
	CONSTRAINT "skill_versions_rejected_has_reason" CHECK ("skill_versions"."status" <> 'rejected' OR "skill_versions"."reject_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"title" text NOT NULL,
	"current_version_id" uuid,
	"created_by_member_id" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skills_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "skills_name_format" CHECK ("skills"."name" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("skills"."name") <= 64),
	CONSTRAINT "skills_archived_by_matches" CHECK (("skills"."archived_at" IS NULL) = ("skills"."archived_by_member_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "worker_skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"status" "worker_skill_status" NOT NULL,
	"assigned_by_member_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_skills_worker_skill_unique" UNIQUE("company_id","worker_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "skill_blobs" ADD CONSTRAINT "skill_blobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version_files" ADD CONSTRAINT "skill_version_files_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version_files" ADD CONSTRAINT "skill_version_files_company_version_fk" FOREIGN KEY ("company_id","version_id") REFERENCES "public"."skill_versions"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_version_files" ADD CONSTRAINT "skill_version_files_company_blob_fk" FOREIGN KEY ("company_id","sha256") REFERENCES "public"."skill_blobs"("company_id","sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_company_skill_fk" FOREIGN KEY ("company_id","skill_id") REFERENCES "public"."skills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_company_created_by_fk" FOREIGN KEY ("company_id","created_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_company_submitted_by_fk" FOREIGN KEY ("company_id","submitted_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_versions" ADD CONSTRAINT "skill_versions_company_decided_by_fk" FOREIGN KEY ("company_id","decided_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_company_created_by_fk" FOREIGN KEY ("company_id","created_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_company_archived_by_fk" FOREIGN KEY ("company_id","archived_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_company_worker_fk" FOREIGN KEY ("company_id","worker_id") REFERENCES "public"."workers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_company_skill_fk" FOREIGN KEY ("company_id","skill_id") REFERENCES "public"."skills"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_company_assigned_by_fk" FOREIGN KEY ("company_id","assigned_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_skills" ADD CONSTRAINT "worker_skills_company_decided_by_fk" FOREIGN KEY ("company_id","decided_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_one_draft_uq" ON "skill_versions" USING btree ("company_id","skill_id") WHERE "skill_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "skill_versions_one_pending_uq" ON "skill_versions" USING btree ("company_id","skill_id") WHERE "skill_versions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "skills_company_name_live_uq" ON "skills" USING btree ("company_id","name") WHERE "skills"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "worker_skills_skill_idx" ON "worker_skills" USING btree ("company_id","skill_id");--> statement-breakpoint
-- ── Pointer to the version in use: same company and same skill ───────────────
ALTER TABLE "skills" ADD CONSTRAINT "skills_current_version_fk"
  FOREIGN KEY ("company_id", "id", "current_version_id")
  REFERENCES "skill_versions" ("company_id", "skill_id", "id");--> statement-breakpoint
-- ── Row-Level Security (design D1) ───────────────────────────────────────────
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skills_tenant" ON "skills"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "skill_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skill_versions_tenant" ON "skill_versions"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "skill_blobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_blobs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skill_blobs_tenant" ON "skill_blobs"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "skill_version_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_version_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skill_version_files_tenant" ON "skill_version_files"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "worker_skills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_skills" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "worker_skills_tenant" ON "worker_skills"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
-- ── Grants for dw_app (default privileges give SELECT, INSERT, UPDATE, DELETE) ─
-- Skills and versions are never deleted: history stays (archive instead).
REVOKE DELETE, TRUNCATE ON "skills" FROM dw_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "skill_versions" FROM dw_app;--> statement-breakpoint
-- Blobs are content-addressed: written once, never changed.
REVOKE UPDATE, DELETE, TRUNCATE ON "skill_blobs" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "skill_version_files" FROM dw_app;--> statement-breakpoint
REVOKE TRUNCATE ON "worker_skills" FROM dw_app;--> statement-breakpoint
-- ── Files change only while their version is a draft (design D1) ─────────────
CREATE FUNCTION "app"."skill_version_files_draft_only"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  DECLARE
    version_status public.skill_version_status;
  BEGIN
    SELECT status INTO version_status FROM public.skill_versions
      WHERE id = (CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END);
    IF version_status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'files of skill version % can change only while it is a draft',
        (CASE WHEN TG_OP = 'DELETE' THEN OLD.version_id ELSE NEW.version_id END)
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN (CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."skill_version_files_draft_only"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "skill_version_files_draft_only" BEFORE INSERT OR DELETE ON "skill_version_files"
  FOR EACH ROW EXECUTE FUNCTION "app"."skill_version_files_draft_only"();--> statement-breakpoint
-- ── A version is frozen once it leaves draft (design D1, D2) ─────────────────
-- draft → pending → approved | rejected | superseded; content changes only in draft.
CREATE FUNCTION "app"."skill_versions_frozen"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF NEW.company_id <> OLD.company_id OR NEW.skill_id <> OLD.skill_id
       OR NEW.number <> OLD.number THEN
      RAISE EXCEPTION 'skill version % cannot move', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (
         NEW.title IS DISTINCT FROM OLD.title
         OR NEW.description IS DISTINCT FROM OLD.description
         OR NEW.has_scripts IS DISTINCT FROM OLD.has_scripts
         OR NEW.suggested_risk IS DISTINCT FROM OLD.suggested_risk
         OR NEW.revision IS DISTINCT FROM OLD.revision) THEN
      RAISE EXCEPTION 'skill version % is frozen', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
         (OLD.status = 'draft' AND NEW.status = 'pending')
         OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'superseded'))) THEN
      RAISE EXCEPTION 'skill version % cannot go from % to %', OLD.id, OLD.status, NEW.status
        USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.ever_approved AND NOT NEW.ever_approved THEN
      RAISE EXCEPTION 'skill version % stays approved', OLD.id USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."skill_versions_frozen"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "skill_versions_frozen" BEFORE UPDATE ON "skill_versions"
  FOR EACH ROW EXECUTE FUNCTION "app"."skill_versions_frozen"();
