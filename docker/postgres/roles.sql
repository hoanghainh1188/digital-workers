-- Roles and database for digital-workers. Run once, as the PostgreSQL superuser,
-- with psql variables: owner_password, app_password.
--   dw_owner: owns the schema and runs migrations.
--   dw_app:   used by api/runner. Not an owner and NOBYPASSRLS, so Row-Level
--             Security policies (change add-tenancy-and-users) really apply to it.

CREATE ROLE dw_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE dw_app LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

CREATE DATABASE dw OWNER dw_owner;

\connect dw

ALTER SCHEMA public OWNER TO dw_owner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON DATABASE dw FROM PUBLIC;
GRANT CONNECT ON DATABASE dw TO dw_app;
GRANT USAGE ON SCHEMA public TO dw_app;

-- Append-only tables (e.g. CreditTransaction) must REVOKE UPDATE, DELETE from dw_app
-- in their own migration, with a test asserting the grant is absent.
ALTER DEFAULT PRIVILEGES FOR ROLE dw_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO dw_app;
ALTER DEFAULT PRIVILEGES FOR ROLE dw_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO dw_app;
