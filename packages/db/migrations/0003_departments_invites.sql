CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'cancelled');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_company_id_id_unique" UNIQUE("company_id","id")
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" NOT NULL,
	"department_id" uuid,
	"invited_by_member_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"accepted_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_department_required" CHECK ("invitations"."role" IN ('owner', 'admin') OR "invitations"."department_id" IS NOT NULL),
	CONSTRAINT "invitations_email_lowercase" CHECK ("invitations"."email" = lower("invitations"."email"))
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "department_id" uuid;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "last_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_member_id_members_id_fk" FOREIGN KEY ("invited_by_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_member_id_members_id_fk" FOREIGN KEY ("accepted_member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_company_department_fk" FOREIGN KEY ("company_id","department_id") REFERENCES "public"."departments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_company_name_active_uq" ON "departments" USING btree ("company_id",lower("name")) WHERE "departments"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_company_email_pending_uq" ON "invitations" USING btree ("company_id","email") WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_department_manager_pending_uq" ON "invitations" USING btree ("department_id") WHERE "invitations"."status" = 'pending' AND "invitations"."role" = 'manager';--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_company_department_fk" FOREIGN KEY ("company_id","department_id") REFERENCES "public"."departments"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "members_department_manager_uq" ON "members" USING btree ("department_id") WHERE "members"."role" = 'manager';--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_department_required" CHECK ("members"."role" IN ('owner', 'admin') OR "members"."department_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_locked_at_matches" CHECK (("members"."status" = 'locked') = ("members"."locked_at" IS NOT NULL));--> statement-breakpoint
-- ── Tenant isolation (design D1) ─────────────────────────────────────────────
-- 1a never locked anyone, so every existing member is active with locked_at NULL.
ALTER TABLE "departments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "departments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "departments_tenant" ON "departments"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invitations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitations_tenant" ON "invitations"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
-- Read-only paths for app.invitation_by_token_hash() (SECURITY DEFINER, runs as dw_owner),
-- same pattern as members_owner_lookup. dw_app never connects as dw_owner.
CREATE POLICY "invitations_owner_lookup" ON "invitations" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
CREATE POLICY "departments_owner_lookup" ON "departments" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
CREATE POLICY "companies_owner_lookup" ON "companies" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
-- ── Invitation lookup by token, before the visitor has a company (design D4) ─
-- Returns at most one row for an exact SHA-256 match; nothing can list invitations.
CREATE FUNCTION "app"."invitation_by_token_hash"(p_token_hash bytea)
  RETURNS TABLE (
    id uuid, company_id uuid, company_name text, inviter_name text,
    email text, role "public"."member_role", department_id uuid, department_name text,
    department_archived boolean, status "public"."invitation_status", expires_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT i.id, i.company_id, c.name, u.name,
           i.email, i.role, i.department_id, d.name,
           d.archived_at IS NOT NULL, i.status, i.expires_at
    FROM public.invitations i
    JOIN public.companies c ON c.id = i.company_id
    JOIN public.members m ON m.id = i.invited_by_member_id
    JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.departments d ON d.id = i.department_id
    WHERE i.token_hash = p_token_hash
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."invitation_by_token_hash"(bytea) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."invitation_by_token_hash"(bytea) TO dw_app;--> statement-breakpoint
-- member_profiles gains department, lock date and last activity (design D6).
DROP VIEW "member_profiles";--> statement-breakpoint
CREATE VIEW "member_profiles" WITH (security_invoker = true) AS
  SELECT m.id, m.company_id, m.user_id, m.role, m.status, m.created_at,
         u.name, u.email, u.email_verified,
         m.department_id, m.locked_at, m.last_seen_at
  FROM public.members m
  JOIN auth.users u ON u.id = m.user_id;--> statement-breakpoint
GRANT SELECT ON "member_profiles" TO dw_app;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "member_profiles" FROM dw_app;
