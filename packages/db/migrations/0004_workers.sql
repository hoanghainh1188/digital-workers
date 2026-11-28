ALTER TABLE "members" ADD CONSTRAINT "members_company_id_id_unique" UNIQUE("company_id","id");--> statement-breakpoint
CREATE TYPE "public"."worker_promotion_status" AS ENUM('pending', 'approved', 'returned', 'closed');--> statement-breakpoint
CREATE TYPE "public"."worker_status" AS ENUM('draft', 'probation', 'active', 'suspended', 'offboarded');--> statement-breakpoint
CREATE TYPE "public"."worker_status_event_kind" AS ENUM('created', 'status_changed', 'proposed', 'proposal_returned', 'probation_extended');--> statement-breakpoint
CREATE TABLE "worker_promotion_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"requested_by_member_id" uuid NOT NULL,
	"note" text,
	"status" "worker_promotion_status" DEFAULT 'pending' NOT NULL,
	"decided_by_member_id" uuid,
	"decided_at" timestamp with time zone,
	"return_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_promotion_requests_company_id_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "worker_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"kind" "worker_status_event_kind" NOT NULL,
	"from_status" "worker_status",
	"to_status" "worker_status" NOT NULL,
	"actor_member_id" uuid NOT NULL,
	"reason" text,
	"request_id" uuid,
	"days" smallint,
	"template_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_testers" (
	"company_id" uuid NOT NULL,
	"worker_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "worker_testers_pk" PRIMARY KEY("worker_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "workers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"avatar_color" smallint DEFAULT 0 NOT NULL,
	"job_description" text DEFAULT '' NOT NULL,
	"voice_preset" text,
	"voice_custom" text,
	"monthly_budget_vnd" bigint NOT NULL,
	"manager_member_id" uuid,
	"status" "worker_status" DEFAULT 'draft' NOT NULL,
	"template_id" text,
	"probation_started_on" date,
	"probation_ends_on" date,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"offboarded_at" timestamp with time zone,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_by_member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workers_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "workers_budget_range" CHECK ("workers"."monthly_budget_vnd" BETWEEN 0 AND 100000000),
	CONSTRAINT "workers_name_length" CHECK (char_length("workers"."name") BETWEEN 1 AND 60),
	CONSTRAINT "workers_job_description_length" CHECK (char_length("workers"."job_description") <= 4000),
	CONSTRAINT "workers_offboarded_at_matches" CHECK (("workers"."status" = 'offboarded') = ("workers"."offboarded_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" ADD CONSTRAINT "worker_promotion_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" ADD CONSTRAINT "worker_promotion_requests_company_worker_fk" FOREIGN KEY ("company_id","worker_id") REFERENCES "public"."workers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" ADD CONSTRAINT "worker_promotion_requests_company_requested_by_fk" FOREIGN KEY ("company_id","requested_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" ADD CONSTRAINT "worker_promotion_requests_company_decided_by_fk" FOREIGN KEY ("company_id","decided_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_events" ADD CONSTRAINT "worker_status_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_events" ADD CONSTRAINT "worker_status_events_company_worker_fk" FOREIGN KEY ("company_id","worker_id") REFERENCES "public"."workers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_events" ADD CONSTRAINT "worker_status_events_company_actor_fk" FOREIGN KEY ("company_id","actor_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_status_events" ADD CONSTRAINT "worker_status_events_company_request_fk" FOREIGN KEY ("company_id","request_id") REFERENCES "public"."worker_promotion_requests"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_testers" ADD CONSTRAINT "worker_testers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_testers" ADD CONSTRAINT "worker_testers_company_worker_fk" FOREIGN KEY ("company_id","worker_id") REFERENCES "public"."workers"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_testers" ADD CONSTRAINT "worker_testers_company_member_fk" FOREIGN KEY ("company_id","member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_department_fk" FOREIGN KEY ("company_id","department_id") REFERENCES "public"."departments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_manager_fk" FOREIGN KEY ("company_id","manager_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workers" ADD CONSTRAINT "workers_company_created_by_fk" FOREIGN KEY ("company_id","created_by_member_id") REFERENCES "public"."members"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "worker_promotion_requests_pending_uq" ON "worker_promotion_requests" USING btree ("worker_id") WHERE "worker_promotion_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "worker_status_events_worker_idx" ON "worker_status_events" USING btree ("worker_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workers_company_name_live_uq" ON "workers" USING btree ("company_id","name_key") WHERE "workers"."status" <> 'offboarded';--> statement-breakpoint
CREATE INDEX "workers_company_department_idx" ON "workers" USING btree ("company_id","department_id");--> statement-breakpoint
-- ── Tenant isolation (design D1) ─────────────────────────────────────────────
ALTER TABLE "workers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "workers_tenant" ON "workers"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "worker_testers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_testers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "worker_testers_tenant" ON "worker_testers"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_promotion_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "worker_promotion_requests_tenant" ON "worker_promotion_requests"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "worker_status_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "worker_status_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "worker_status_events_tenant" ON "worker_status_events"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
-- ── Grants for dw_app (default privileges give SELECT, INSERT, UPDATE, DELETE) ─
-- Workers are never deleted: dropping a draft is offboarding (0.2 #106).
REVOKE DELETE, TRUNCATE ON "workers" FROM dw_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "worker_promotion_requests" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "worker_testers" FROM dw_app;--> statement-breakpoint
-- Status history is append-only, like audit_events.
REVOKE UPDATE, DELETE, TRUNCATE ON "worker_status_events" FROM dw_app;--> statement-breakpoint
-- ── Offboarding is final (FR-02-06): an offboarded row can no longer change ───
CREATE FUNCTION "app"."workers_offboarded_frozen"() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, pg_temp
  AS $$
  BEGIN
    IF OLD.status = 'offboarded' THEN
      RAISE EXCEPTION 'worker % is offboarded and cannot change', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."workers_offboarded_frozen"() FROM PUBLIC;--> statement-breakpoint
CREATE TRIGGER "workers_offboarded_frozen" BEFORE UPDATE ON "workers"
  FOR EACH ROW EXECUTE FUNCTION "app"."workers_offboarded_frozen"();
