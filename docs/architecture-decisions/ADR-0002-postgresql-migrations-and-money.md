# ADR-0002: PostgreSQL for all CRM persistence

- **Status:** Accepted by user request
- **Date:** 2026-10-19

The CRM and both Tally connector flows use PostgreSQL through `DATABASE_URL`. The application has no embedded database or fallback storage. The Node HTTP server and existing API contracts remain in place.

Ordered migrations in `database/postgres/migrations/` create the schema. The runner locks migration execution and records SHA-256 checksums; applied files must not be edited. Startup applies pending migrations before seeding the first owner. Existing connector migration records acquire checksums on upgrade.

CRM-owned direct Tally jobs use `crm_tally_sync_jobs`. Remote connector jobs retain the existing `tally_sync_jobs` table and UUID identifiers. Audit and revision immutability are enforced by PostgreSQL triggers. Case-insensitive unique business identifiers use `citext`. New document numbers use PostgreSQL sequences, so rolled-back requests can leave numbering gaps.

Numeric quantities and amounts use `NUMERIC(20,6)`. The API retains JavaScript number calculations for compatibility; a future rounding/currency policy must precede changes to those calculations.

Multi-statement request transactions reserve one pooled connection and roll back unfinished work before releasing it. Backups use custom-format `pg_dump` archives; restore tests run `pg_restore` into disposable databases. Test connections require permission to create and drop test databases.
