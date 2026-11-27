// Drizzle schema. Business tables carry company_id + RLS (design D1, D3).
// Better Auth tables (./auth.ts) are deliberately not re-exported here.
export * from './tenancy.ts';
