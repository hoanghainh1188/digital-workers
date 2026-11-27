#!/bin/sh
# Runs from /docker-entrypoint-initdb.d on first start of an empty data volume.
set -eu
: "${DW_OWNER_PASSWORD:?DW_OWNER_PASSWORD is required}"
: "${DW_APP_PASSWORD:?DW_APP_PASSWORD is required}"
psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname postgres \
  -v owner_password="$DW_OWNER_PASSWORD" \
  -v app_password="$DW_APP_PASSWORD" \
  -f /dw/roles.sql
