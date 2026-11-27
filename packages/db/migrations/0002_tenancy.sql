CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'manager', 'member');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('active', 'locked');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"actor_member_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"fields" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" NOT NULL,
	"status" "member_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "members_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_company_created_idx" ON "audit_events" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "members_company_id_idx" ON "members" USING btree ("company_id");--> statement-breakpoint
-- ── Tenant isolation (design D3) ─────────────────────────────────────────────
CREATE SCHEMA "app";--> statement-breakpoint
REVOKE ALL ON SCHEMA "app" FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA "app" TO dw_app;--> statement-breakpoint
-- The company set by withCompany() for the current transaction, or NULL.
-- NULLIF: once a transaction-local setting ends, current_setting() returns '' (not NULL).
CREATE FUNCTION "app"."current_company_id"() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."current_company_id"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."current_company_id"() TO dw_app;--> statement-breakpoint
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "companies_tenant" ON "companies"
  USING ("id" = "app"."current_company_id"())
  WITH CHECK ("id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "members_tenant" ON "members"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
-- Read-only path for app.member_for_user() (SECURITY DEFINER, runs as dw_owner).
-- dw_app never connects as dw_owner, so this does not widen what the app sees.
CREATE POLICY "members_owner_lookup" ON "members" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "audit_events_tenant" ON "audit_events"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
-- Append-only (spec audit-log): the application role may only INSERT and SELECT.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_events" FROM dw_app;--> statement-breakpoint
-- ── Session → member lookup: the single, narrow path around RLS ─────────────
CREATE FUNCTION "app"."member_for_user"(p_user_id uuid)
  RETURNS TABLE (member_id uuid, company_id uuid, role "public"."member_role", status "public"."member_status")
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT m.id, m.company_id, m.role, m.status
    FROM public.members m
    WHERE m.user_id = p_user_id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."member_for_user"(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."member_for_user"(uuid) TO dw_app;--> statement-breakpoint
-- Names / emails for business code. security_invoker keeps the members policy in force.
CREATE VIEW "member_profiles" WITH (security_invoker = true) AS
  SELECT m.id, m.company_id, m.user_id, m.role, m.status, m.created_at,
         u.name, u.email, u.email_verified
  FROM public.members m
  JOIN auth.users u ON u.id = m.user_id;--> statement-breakpoint
GRANT SELECT ON "member_profiles" TO dw_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "member_profiles" FROM dw_app;
