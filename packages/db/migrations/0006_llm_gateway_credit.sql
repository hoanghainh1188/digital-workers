CREATE TYPE "public"."credit_reason" AS ENUM('bank_transfer', 'trial', 'system_fix', 'other');--> statement-breakpoint
CREATE TYPE "public"."credit_transaction_kind" AS ENUM('usage', 'trial', 'adjustment');--> statement-breakpoint
CREATE TABLE "auth"."two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cost_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"worker_id" uuid,
	"task_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"price_id" uuid NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer NOT NULL,
	"cache_write_tokens" integer NOT NULL,
	"vnd_per_usd" integer NOT NULL,
	"multiplier_permille" integer NOT NULL,
	"real_cost_microvnd" bigint NOT NULL,
	"charge_microvnd" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cost_entries_company_id_id_unique" UNIQUE("company_id","id"),
	CONSTRAINT "cost_entries_tokens_non_negative" CHECK ("cost_entries"."input_tokens" >= 0 AND "cost_entries"."output_tokens" >= 0 AND "cost_entries"."cache_read_tokens" >= 0 AND "cost_entries"."cache_write_tokens" >= 0),
	CONSTRAINT "cost_entries_money_non_negative" CHECK ("cost_entries"."real_cost_microvnd" >= 0 AND "cost_entries"."charge_microvnd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "credit_accounts" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"balance_vnd" bigint DEFAULT 0 NOT NULL,
	"carry_microvnd" bigint DEFAULT 0 NOT NULL,
	"multiplier_permille" integer,
	"last_credit_vnd" bigint DEFAULT 0 NOT NULL,
	"low_notified" boolean DEFAULT false NOT NULL,
	"zero_notified" boolean DEFAULT false NOT NULL,
	"trial_granted_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_accounts_carry_range" CHECK ("credit_accounts"."carry_microvnd" BETWEEN 0 AND 999999),
	CONSTRAINT "credit_accounts_multiplier" CHECK ("credit_accounts"."multiplier_permille" IS NULL OR "credit_accounts"."multiplier_permille" >= 1000)
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" "credit_transaction_kind" NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"balance_after_vnd" bigint NOT NULL,
	"cost_entry_id" uuid,
	"reason" "credit_reason",
	"note" text,
	"actor_admin_id" uuid,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_transactions_cost_entry_id_unique" UNIQUE("cost_entry_id"),
	CONSTRAINT "credit_transactions_idempotency_unique" UNIQUE("company_id","idempotency_key"),
	CONSTRAINT "credit_transactions_usage_shape" CHECK (("credit_transactions"."kind" = 'usage') = ("credit_transactions"."cost_entry_id" IS NOT NULL) AND ("credit_transactions"."kind" <> 'usage' OR ("credit_transactions"."amount_vnd" <= 0 AND "credit_transactions"."reason" IS NULL))),
	CONSTRAINT "credit_transactions_adjustment_shape" CHECK ("credit_transactions"."kind" <> 'adjustment' OR ("credit_transactions"."reason" IS NOT NULL AND "credit_transactions"."note" IS NOT NULL AND "credit_transactions"."amount_vnd" <> 0)),
	CONSTRAINT "credit_transactions_trial_positive" CHECK ("credit_transactions"."kind" <> 'trial' OR "credit_transactions"."amount_vnd" > 0),
	CONSTRAINT "credit_transactions_note_length" CHECK ("credit_transactions"."note" IS NULL OR char_length("credit_transactions"."note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vnd_per_usd" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_positive" CHECK ("fx_rates"."vnd_per_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_usd_micros_per_mtok" bigint NOT NULL,
	"output_usd_micros_per_mtok" bigint NOT NULL,
	"cache_read_usd_micros_per_mtok" bigint NOT NULL,
	"cache_write_usd_micros_per_mtok" bigint,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_prices_model_effective_unique" UNIQUE("provider","model","effective_from"),
	CONSTRAINT "model_prices_provider" CHECK ("model_prices"."provider" IN ('anthropic', 'openai')),
	CONSTRAINT "model_prices_model_length" CHECK (char_length("model_prices"."model") BETWEEN 1 AND 100),
	CONSTRAINT "model_prices_non_negative" CHECK ("model_prices"."input_usd_micros_per_mtok" >= 0 AND "model_prices"."output_usd_micros_per_mtok" >= 0 AND "model_prices"."cache_read_usd_micros_per_mtok" >= 0 AND ("model_prices"."cache_write_usd_micros_per_mtok" IS NULL OR "model_prices"."cache_write_usd_micros_per_mtok" >= 0))
);
--> statement-breakpoint
CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"company_id" uuid,
	"fields" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_multipliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"permille" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "price_multipliers_at_least_one" CHECK ("price_multipliers"."permille" >= 1000)
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"provider" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_ok_at" timestamp with time zone,
	CONSTRAINT "provider_keys_provider" CHECK ("provider_keys"."provider" IN ('anthropic', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "auth"."users" ADD COLUMN "two_factor_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "auth"."two_factors" ADD CONSTRAINT "two_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_entries" ADD CONSTRAINT "cost_entries_price_id_model_prices_id_fk" FOREIGN KEY ("price_id") REFERENCES "public"."model_prices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_cost_entry_fk" FOREIGN KEY ("company_id","cost_entry_id") REFERENCES "public"."cost_entries"("company_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "two_factors_user_id_idx" ON "auth"."two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "two_factors_secret_idx" ON "auth"."two_factors" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "cost_entries_company_created_idx" ON "cost_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "cost_entries_company_worker_created_idx" ON "cost_entries" USING btree ("company_id","worker_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_transactions_one_trial_uq" ON "credit_transactions" USING btree ("company_id") WHERE "credit_transactions"."kind" = 'trial';--> statement-breakpoint
CREATE INDEX "credit_transactions_company_created_idx" ON "credit_transactions" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "fx_rates_effective_idx" ON "fx_rates" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "platform_audit_events_created_idx" ON "platform_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "price_multipliers_effective_idx" ON "price_multipliers" USING btree ("effective_from");--> statement-breakpoint
-- Read paths for SECURITY DEFINER functions (run as dw_owner) exist for companies and
-- members since 0002/0003; the credit tables get theirs below. dw_app never connects
-- as dw_owner, so these do not widen what the app sees.
-- ── Seed (0.2 #102): 25.400đ / USD, default multiplier 1,30. No model prices. ─
INSERT INTO "fx_rates" ("vnd_per_usd", "effective_from") VALUES (25400, now());--> statement-breakpoint
INSERT INTO "price_multipliers" ("permille", "effective_from") VALUES (1300, now());--> statement-breakpoint
-- ── Existing companies (dev data only, 0.2 #104): an account, plus the trial ──
-- credit when the company already has an Owner with a verified email.
INSERT INTO "credit_accounts" ("company_id") SELECT "id" FROM "companies";--> statement-breakpoint
WITH eligible AS (
  SELECT DISTINCT m.company_id
  FROM "members" m JOIN "auth"."users" u ON u.id = m.user_id
  WHERE m.role = 'owner' AND u.email_verified
), granted AS (
  INSERT INTO "credit_transactions" ("company_id", "kind", "amount_vnd", "balance_after_vnd", "reason")
  SELECT company_id, 'trial', 200000, 200000, 'trial' FROM eligible
  RETURNING company_id
)
UPDATE "credit_accounts" a
SET "balance_vnd" = 200000, "last_credit_vnd" = 200000, "trial_granted_at" = now()
FROM granted g WHERE a.company_id = g.company_id;--> statement-breakpoint
-- ── Tenant isolation ─────────────────────────────────────────────────────────
ALTER TABLE "credit_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_accounts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "credit_accounts_tenant" ON "credit_accounts"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
CREATE POLICY "credit_accounts_owner_lookup" ON "credit_accounts" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
ALTER TABLE "credit_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_transactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "credit_transactions_tenant" ON "credit_transactions"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
CREATE POLICY "credit_transactions_owner_lookup" ON "credit_transactions" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
ALTER TABLE "cost_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cost_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "cost_entries_tenant" ON "cost_entries"
  USING ("company_id" = "app"."current_company_id"())
  WITH CHECK ("company_id" = "app"."current_company_id"());--> statement-breakpoint
CREATE POLICY "cost_entries_owner_lookup" ON "cost_entries" FOR SELECT TO dw_owner USING (true);--> statement-breakpoint
-- ── Grants (default privileges give dw_app SELECT, INSERT, UPDATE, DELETE) ───
-- Append-only ledgers and price history (spec credit-ledger, model-pricing, platform-admin).
REVOKE UPDATE, DELETE, TRUNCATE ON "credit_transactions" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "cost_entries" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "model_prices" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "fx_rates" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "price_multipliers" FROM dw_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "platform_audit_events" FROM dw_app;--> statement-breakpoint
-- An account is never deleted; a key is replaced by UPDATE (the old one is overwritten).
REVOKE DELETE, TRUNCATE ON "credit_accounts" FROM dw_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "provider_keys" FROM dw_app;--> statement-breakpoint
-- ── Platform admin: per-company totals only (design D10, 0.2 #077) ───────────
-- The second narrow path around RLS. Returns aggregate columns and nothing else;
-- only apps/api/src/platform/ calls it (guarded by a test).
CREATE FUNCTION "app"."platform_company_summaries"()
  RETURNS TABLE (
    company_id uuid,
    name text,
    owner_email text,
    balance_vnd bigint,
    last_credit_vnd bigint,
    charged_30d_vnd bigint,
    real_cost_30d_microvnd bigint,
    multiplier_permille integer,
    last_used_at timestamptz,
    created_at timestamptz
  )
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, pg_temp
  AS $$
    SELECT c.id,
           c.name,
           (SELECT u.email FROM public.members m JOIN auth.users u ON u.id = m.user_id
             WHERE m.company_id = c.id AND m.role = 'owner'
             ORDER BY m.created_at, m.id LIMIT 1),
           COALESCE(a.balance_vnd, 0),
           COALESCE(a.last_credit_vnd, 0),
           COALESCE((SELECT -sum(t.amount_vnd) FROM public.credit_transactions t
             WHERE t.company_id = c.id AND t.kind = 'usage'
               AND t.created_at >= now() - interval '30 days'), 0)::bigint,
           COALESCE((SELECT sum(e.real_cost_microvnd) FROM public.cost_entries e
             WHERE e.company_id = c.id AND e.created_at >= now() - interval '30 days'), 0)::bigint,
           a.multiplier_permille,
           (SELECT max(e.created_at) FROM public.cost_entries e WHERE e.company_id = c.id),
           c.created_at
    FROM public.companies c
    LEFT JOIN public.credit_accounts a ON a.company_id = c.id
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "app"."platform_company_summaries"() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "app"."platform_company_summaries"() TO dw_app;
