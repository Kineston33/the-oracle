# Deployment & Architecture Notes

THE ORACLE consists of two distinct layers with different runtime and deployment
requirements:

1. **Frontend (`src/` → `dist/`)**: A React + Vite single-page application (SPA)
   compiled by `npm run build` into static assets in `dist/`. The frontend bundle
   contains no server code, requires no database credentials, and never connects
   directly to PostgreSQL.
2. **Backend (`src/server/`)**: A Node.js HTTP read API (`src/server/api.ts`,
   `src/server/index.ts`), persistent PostgreSQL 16+ `PublicationRegistry`
   adapter (`src/server/postgres-registry.ts`), and SQL migration/security-audit
   runner (`src/server/migrate.ts`,
   `src/server/migrations/0001_oracle_ledger_v1_10.sql`,
   `src/server/migrations/audit_v1_10.sql`) implementing Official Publication
   Protocol v1.10 (`docs/PUBLICATION-API-CONTRACT.md`).

> **Current deployment status**: The backend in `src/server/` is implemented and
> verified against local and CI PostgreSQL 16 instances, and GitHub Actions is
> configured to manage temporary Neon branches for pull requests. **However, the
> Node.js backend server is not deployed to a production host, and Neon is not
> yet connected to a live backend runtime.**

---

## 1. Frontend deployment (static SPA)

The frontend (`dist/`) can be deployed as a static site to serve the interface
and the bundled illustrative (`demo: true`) archive without a backend server, or
alongside a deployed Node.js backend API.

### SPA fallback routing requirement

Every frontend route must serve `index.html`, because client-side routing happens
in the browser. Without this rule, `/predictions/ORC-2025-0007` returns a
host-level 404 on reload or when pasted into a new tab.

One config file is already committed, so pick the static host that reads it:

| Host | File already present | Action needed |
|---|---|---|
| Netlify | `public/_redirects` | None — connect the repo, publish `dist` |
| Cloudflare Pages | `public/_redirects` | None — build command `npm run build`, output `dist` |
| Vercel | `public/vercel.json` | None — detected automatically |

Any other static host requires an equivalent rewrite rule:

```
/*  /index.html  200
```

### Frontend build characteristics

- **Static artifact**: `npm run build` outputs `dist/` with no server runtime
  bundled into client code (`src/server/` is excluded by `tsconfig.app.json`).
- **Bandwidth**: the client bundle is ~1.1 MB total, of which ~400 kB is font
  files subset by `unicode-range` and fetched on demand. `og-image.png` is
  148 kB and is fetched by social crawlers only.
- **No frontend secrets**: the browser build reads no database credentials or
  API keys; `DATABASE_URL` and `NEON_API_KEY` must never be exposed to `VITE_*`
  client variables.

### Before the first public frontend deploy

1. **Replace the placeholder origin** `https://the-oracle.example` in two places:
   `index.html` (canonical, `og:url`, `og:image`) and
   `src/components/layout/RouteMetadata.tsx` (`ORIGIN`). Open Graph images
   **must** be absolute URLs or previews silently break.
2. **Decide on indexing.** `index.html` currently sets
   `<meta name="robots" content="noindex, nofollow">` because the bundled archive
   holds demonstration records (`demo: true`). Remove that tag only once official
   records are served; leave it in place and search engines will ignore the site.
3. **Verify the routes** against the deployed origin, not just locally. Reload
   each one directly rather than navigating to it.
4. **Keep `demo: true` records clearly labelled.** Never present illustrative
   DEMO probabilities as official real forecasts.

### Verifying a static frontend build locally

```bash
npm run build
npx vite preview --port 4173     # serves dist/ with SPA fallback

# Every route should return 200 and contain the app shell
for r in / /explore /predictions /predictions/ORC-2025-0007 /trends /about /nope; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:4173$r")" "$r"
done
```

`vite preview` applies the SPA fallback itself, so a 200 here does **not** prove
the static host is configured. Always re-test against the real origin.

---

## 2. Backend deployment requirements (`src/server/` + PostgreSQL 16+)

Serving official predictions (`demo: false`) and the ledger read API
(`GET /v1/predictions`, `GET /v1/predictions/:id`,
`GET /v1/predictions/:id/events`) requires:

1. **A Node.js runtime environment** (Node.js 22+ recommended) running the HTTP
   service in `src/server/index.ts` (`startOracleServer()` /
   `runOracleServerCli()`).
2. **A PostgreSQL 16+ database** (`server_version_num >= 160000`) where:
   - Migration `src/server/migrations/0001_oracle_ledger_v1_10.sql` has been
     applied out-of-band via `runLedgerMigrations()` using a direct (non-pooled)
     administrative/migration connection.
   - The §2.5 live catalog security audit (`src/server/migrations/audit_v1_10.sql`
     via `runLedgerSecurityAudit()`) has verified `oracle_migrator` ownership
     (`NOLOGIN`) and restricted `oracle_app` runtime privileges (`compliant: true`,
     zero violations).
   - The Node.js server connects at runtime using `DATABASE_URL` configured for
     the least-privilege `oracle_app` role.

### Safe PostgreSQL 16+ migration & `oracle_app` verification (`npm run db:migrate`)

Before connecting Render (or any runtime host) with `DATABASE_URL`, initialize
the target **test branch** in Neon using the dedicated migration CLI
(`src/server/migrate.ts` via `npm run db:migrate`):

```bash
# 1. Obtain the DIRECT (non-pooled) administrative connection string for a
#    non-production Neon test branch (e.g. preview/pr-5-... or test/init-check)
#    in project wispy-cell-45340306:
#      neon connection-string <test-branch-name> --project-id wispy-cell-45340306

# 2. Execute the migration and §2.5 security audit against the test branch:
MIGRATION_DATABASE_URL="postgresql://neondb_owner:<owner_password>@ep-<endpoint>.<region>.aws.neon.tech/neondb?sslmode=require" \
  ORACLE_APP_PASSWORD="<strong_oracle_app_password>" \
  npm run db:migrate -- --expected-branch "<test-branch-name>"
```

#### Mandatory safety & production-protection guarantees (`npm run db:migrate`)

1. **Exclusive `MIGRATION_DATABASE_URL` (direct, non-pooled connection)**:
   - Reads **only** `MIGRATION_DATABASE_URL` — never falls back to or uses
     `DATABASE_URL`, and rejects any call where `MIGRATION_DATABASE_URL` equals
     `DATABASE_URL`.
   - Rejects pooled endpoints (`-pooler` in hostname or `pgbouncer=true` in
     query string), non-SSL Neon URLs, and connections attempting to run as
     `oracle_app` or `oracle_migrator`.
2. **Production branch blocked by default (anti-spoofing branch verification)**:
   - Never trusts a standalone environment variable label (such as
     `NODE_ENV=staging` or `MIGRATION_EXPECTED_BRANCH=staging`) by itself.
   - Probes the live PostgreSQL server (`pg_catalog.current_database()`,
     `pg_control_system()`, `pg_is_in_recovery()`, `inet_server_addr()`,
     `pg_shdescription`, and Neon hypervisor GUCs `neon.project_id`,
     `neon.branch_id`, `neon.timeline_id`).
   - Resolves the endpoint hostname (`ep-...`) to its authoritative Neon branch
     via the Neon control plane (`neon` CLI or `NEON_API_KEY` REST API) or
     verifies the server's `neon.branch_id` GUC against both
     `MIGRATION_EXPECTED_BRANCH_ID` and `NEON_PRODUCTION_BRANCH_ID`.
   - **Blocks execution immediately** if:
     - The resolved branch is `production` / `main`, or has `default: true`,
       `primary: true`, or `protected: true`;
     - The database catalog description (`COMMENT ON DATABASE`) marks it as
       `production`; or
     - The real branch identity of a remote/Neon endpoint cannot be verified
       (fail-closed).
3. **Transactional DDL, `oracle_app` provisioning, and post-migration audit**:
   - Executes `0001_oracle_ledger_v1_10.sql` and configures `oracle_app`'s login
     password inside an explicit `BEGIN ... COMMIT` transaction (supporting both
     PostgreSQL superusers and Neon's non-superuser `neondb_owner` role).
   - Runs `runLedgerSecurityAudit()` (§2.5 Steps A, B, and C) and verifies zero
     role-membership or privilege/ACL violations (`compliant: true`).
   - When `ORACLE_APP_PASSWORD` is provided, opens a live verification
     connection as `oracle_app` to confirm `CURRENT_USER = 'oracle_app'`,
     `SESSION_USER = 'oracle_app'`, and `SELECT` access on the three ledger
     tables.
   - Prints a sanitized report without exposing passwords, connection strings,
     API keys, or tokens.

### Installation, compilation, and startup commands

```bash
# 1. Install dependencies from the lockfile
npm ci

# 2. Validate archive, typecheck, build the frontend SPA (dist/) AND compile the
#    standalone Node.js server bundle (build/server/index.js)
npm run build

#    (Or compile only the backend bundle into build/server/index.js)
npm run build:server

# 3. Start the production HTTP read API server (executes `node build/server/index.js`)
#    Requires DATABASE_URL authenticated as the restricted `oracle_app` role.
DATABASE_URL="postgresql://oracle_app:<password>@<host>/<dbname>?sslmode=require" \
  HOST="0.0.0.0" \
  PORT="3001" \
  npm start
```

On Node.js 22+, `node src/server/index.ts` can also be invoked directly.

### Runtime startup & shutdown guarantees (`src/server/index.ts`)

When started via `npm start` (`node build/server/index.js`) or
`startOracleServer()`:

- **Uses `DATABASE_URL` (plus optional `HOST` and `PORT`)**: refuses to start if
  `DATABASE_URL` is missing or empty.
- **Executes `verifyRuntimeDatabaseRole()` before listening on any TCP port**:
  queries `pg_catalog` and rejects the connection with
  `RuntimeRoleSecurityError` if `CURRENT_USER <> 'oracle_app'`,
  `SESSION_USER <> 'oracle_app'` (for example, a superuser session disguised via
  `SET ROLE oracle_app`), or if the role holds any superuser, `INHERIT`,
  `CREATEDB`, `CREATEROLE`, `BYPASSRLS`, `REPLICATION`, role-membership, object
  ownership, schema `CREATE`, or direct table DML/DDL privilege.
- **Never executes database migrations automatically at runtime**: DDL
  migrations (`runLedgerMigrations()`) are strictly separated from the runtime
  process; supplying administrative credentials in `DATABASE_URL` causes
  immediate startup rejection.
- **Graceful shutdown on `SIGTERM` and `SIGINT`**: closes the HTTP server to new
  requests, drains in-flight connections, closes the PostgreSQL connection pool
  (`pool.end()`), and exits with code `0`.
- **No secret leakage in logs**: startup and shutdown logs redact any
  `postgres://` / `postgresql://` URIs and `password=` tokens via
  `redactSecrets()`.

---

## 3. Environment variables & secrets reference

Never hardcode, log, or commit real credentials. The table below lists the
variables used across the backend runtime, migrations, and CI workflows using
placeholder formats only:

| Scope | Variable / Secret | Required? | Purpose & placeholder format |
|---|---|---|---|
| Backend runtime (`src/server/index.ts`) | `DATABASE_URL` | Required when running backend | PostgreSQL 16+ connection string for the restricted `oracle_app` runtime role, e.g. `postgresql://oracle_app:<password>@<host>/<dbname>?sslmode=require` |
| Backend runtime (`src/server/index.ts`) | `PORT` | Optional (default `3001`) | TCP port for the Node.js HTTP read API server |
| Backend runtime (`src/server/index.ts`) | `HOST` | Optional (default `0.0.0.0`) | Bind address for the Node.js HTTP read API server |
| One-off migration / audit (`src/server/migrate.ts`) | `MIGRATION_DATABASE_URL` *(caller-supplied)* | Required when applying DDL | Direct (non-`-pooler`) PostgreSQL 16+ admin/migration connection string used to run `runLedgerMigrations()` and `runLedgerSecurityAudit()` |
| One-off migration / audit (`src/server/migrate.ts`) | `ORACLE_APP_PASSWORD` *(caller-supplied)* | Required for `npm run db:migrate` | Strong password (>= 60 bits of entropy: 12+ chars with uppercase, lowercase, digits, and symbols) assigned to the `oracle_app` login role and verified via live TCP login |
| GitHub Actions CI (`.github/workflows/postgres-ci.yml`) | `TEST_DATABASE_ADMIN_URL` | Set by CI workflow | Ephemeral connection string pointing to the per-run `postgres:16` Docker service container in GitHub Actions |
| GitHub Actions Neon PR workflow (`.github/workflows/neon-workflow.yml`) | `vars.NEON_PROJECT_ID` | Required in GitHub Actions | Repository variable storing the Neon project ID (`wispy-cell-45340306`) |
| GitHub Actions Neon PR workflow (`.github/workflows/neon-workflow.yml`) | `secrets.NEON_API_KEY` | Required in GitHub Actions | Repository secret storing the Neon API key used to create/delete temporary PR branches and resolve branch identity |
| GitHub Actions Neon PR workflow (`.github/workflows/neon-workflow.yml`) | `secrets.ORACLE_APP_PASSWORD` | Required in GitHub Actions | Repository secret storing the password assigned to `oracle_app` when running `npm run db:migrate` against temporary PR `preview/` branches |
| GitHub Actions Production Migration (`production-migration` environment in `.github/workflows/neon-production-migration.yml`) | `secrets.PRODUCTION_MIGRATION_DATABASE_URL` | Required in `production-migration` environment | Direct (non-`-pooler`) PostgreSQL 16+ administrative (`neondb_owner`) connection string for the Neon `production` branch (`?sslmode=require`); never accepted as a workflow input |
| GitHub Actions Production Migration (`production-migration` environment in `.github/workflows/neon-production-migration.yml`) | `vars.NEON_PRODUCTION_BRANCH_ID` | Required in repository or `production-migration` environment | Authoritative Neon branch ID (`br-...`) of the `production` branch in project `wispy-cell-45340306`, verified against the Neon API response |

---

## 4. Ephemeral CI / PR databases vs. persistent production storage

It is essential to distinguish the temporary databases used in automated
workflows from a persistent production database:

| Environment | How it is provisioned | Lifecycle & persistence | Connected to a deployed backend? |
|---|---|---|---|
| **Local / CI PostgreSQL 16 test instances** (`src/server/postgres-integration.test.ts`, `.github/workflows/postgres-ci.yml`) | Local on-disk `initdb`/`pg_ctl` PostgreSQL 16.16 cluster during `npm test`, plus the `postgres:16` Docker service container in GitHub Actions | **Ephemeral**: created for the test run and destroyed immediately when the test suite or CI job finishes | **No** — used strictly for automated integration verification of DDL, triggers, `SECURITY DEFINER` functions, and API handlers |
| **Neon temporary PR branches** (`.github/workflows/neon-workflow.yml`) | Provisioned in Neon via `neondatabase/create-branch-action@v6` (`preview/pr-<number>-<head_ref>`) when a PR is opened, reopened, or updated | **Temporary (14-day TTL)**: deleted automatically by `neondatabase/delete-branch-action@v3` when the PR closes, or after 14 days via `expires_at` | **No** — isolated preview branches per PR; not connected to a deployed Node.js backend or production archive |
| **Persistent production database** *(target architecture, not yet connected)* | Dedicated long-lived PostgreSQL 16+ branch/instance (e.g. Neon `production` branch) initialized with `0001_oracle_ledger_v1_10.sql` | **Persistent append-only ledger**: retains official predictions (`demo: false`), event chains, and idempotency keys indefinitely | **Not yet connected / deployed** — requires injecting `DATABASE_URL` (`oracle_app`) into a hosted Node.js runtime after running migrations and the §2.5 security audit |

---

## 5. Neon GitHub Actions integration (`.github/workflows/neon-workflow.yml`)

Pull requests automatically provision and clean up isolated temporary PostgreSQL
branches in Neon via `.github/workflows/neon-workflow.yml`, while
`.github/workflows/postgres-ci.yml` runs the repository validation, typecheck,
build, and PostgreSQL 16 integration suite.

### Required GitHub Actions settings

| Type | Name | Description |
|---|---|---|
| Repository variable | `NEON_PROJECT_ID` | Neon project identifier (referenced via `${{ vars.NEON_PROJECT_ID }}`) |
| Repository secret | `NEON_API_KEY` | Neon API key (referenced via `${{ secrets.NEON_API_KEY }}`; never logged or committed) |
| Repository secret | `ORACLE_APP_PASSWORD` | Strong password (>= 60 bits of entropy) assigned to the restricted `oracle_app` runtime role during `npm run db:migrate` on the PR preview branch |

### Workflow lifecycle and guarantees

- **Branch creation / reuse & safe migration (`opened`, `reopened`, `synchronize`)**:
  - Computes an RFC 3339 UTC timestamp 14 days in the future
    (`date -u --date '+14 days' +'%Y-%m-%dT%H:%M:%SZ'`) and passes it as
    `expires_at` to `neondatabase/create-branch-action@v6`.
  - Creates (or reuses on `synchronize` / `reopened`) a branch named
    `preview/pr-<number>-<head_ref>`.
  - Masks sensitive step outputs (`password`, `db_url`, `db_url_pooled`) in the
    runner log stream via `::add-mask::` and exposes only non-sensitive job
    outputs (`branch_id`, `created`, `db_host`, `db_host_pooled`) bound directly
    to `steps.create_neon_branch.outputs.*`.
  - Installs Node.js 22 (`npm ci`) and runs `npm run db:migrate` against the
    temporary `preview/pr-<number>-<head_ref>` branch using exclusively the
    direct `steps.create_neon_branch.outputs.db_url` as `MIGRATION_DATABASE_URL`,
    `secrets.NEON_API_KEY` for control-plane branch verification, and
    `secrets.ORACLE_APP_PASSWORD` for `oracle_app` provisioning and live login
    verification. Aborts immediately if `ORACLE_APP_PASSWORD` is missing, if the
    endpoint is pooled, or if the target branch is not a verified `preview/pr-*`
    branch.
- **Branch deletion (`closed`)**:
  - Deletes `preview/pr-<number>-<head_ref>` via
    `neondatabase/delete-branch-action@v3` when the pull request is closed or
    merged. If deletion is skipped for any reason, the 14-day `expires_at` TTL
    guarantees automatic cleanup in Neon.

---

## 6. Official Production Migration Protocol v1.0 (`.github/workflows/neon-production-migration.yml`)

Ordinary migration invocations (`npm run db:migrate`) **always reject**
`production`, `main`, `default`, `primary`, and `protected` Neon branches by
default. Applying `0001_oracle_ledger_v1_10.sql` to the Neon `production` branch
is restricted to a dedicated, manually dispatched (`workflow_dispatch` only) and
fail-closed workflow: `.github/workflows/neon-production-migration.yml`.

### Required one-time setup in GitHub (`Settings → Environments`)

1. Create a dedicated GitHub Environment named **`production-migration`** (optionally
   with required reviewers and a deployment branch restriction to `main` only).
2. Configure the following secret inside the **`production-migration`**
   environment:
   - **`PRODUCTION_MIGRATION_DATABASE_URL`**: Direct (non-`-pooler`) PostgreSQL
     16+ connection URI for `neondb_owner` on the Neon `production` branch
     (`postgresql://neondb_owner:<password>@ep-<prod-endpoint>.<region>.aws.neon.tech/neondb?sslmode=require`).
     This connection string is **never** accepted as a workflow input and must
     never be placed in runtime `DATABASE_URL`.
3. Ensure the following repository/environment variables and secrets are present:
   - Variable **`NEON_PROJECT_ID`**: `wispy-cell-45340306` (must match `.neon`).
   - Variable **`NEON_PRODUCTION_BRANCH_ID`**: The exact Neon branch ID
     (`br-...`) of the `production` branch (obtainable via
     `neon branches list --project-id wispy-cell-45340306`).
   - Secret **`NEON_API_KEY`**: Neon API key used for authoritative control-plane
     verification of the endpoint and branch.
   - Secret **`ORACLE_APP_PASSWORD`**: Strong password (>= 60 bits of entropy)
     provisioned for the restricted `oracle_app` runtime role.

### Manual execution procedure

1. In GitHub, open **Actions → Official Production Migration Protocol v1.0 (Neon)**.
2. Select **Run workflow** on branch **`main`**.
3. Enter the required inputs:
   - `confirm_production`: Type **`APPLY_PRODUCTION_MIGRATION`** (exact match).
   - `expected_branch`: **`production`** (exact match).
4. Click **Run workflow** and approve the **`production-migration`** environment
   gate if required reviewers are configured.

### Mandatory fail-closed verification gates enforced on the production path

The workflow and `verifyMigrationTargetIdentity()` abort before any DDL
statement if **any** of the following checks fails:

1. **Dedicated CLI flags required (never environment variables alone)**:
   Requires `--allow-production-migration` and
   `--confirm-production APPLY_PRODUCTION_MIGRATION` on the CLI. Setting
   environment variables without the CLI flags is ignored and rejected.
2. **Manual `workflow_dispatch` on `main` only**: Rejects any execution not
   triggered via `workflow_dispatch` on `refs/heads/main`.
3. **Exact branch name (`production`) and exact branch ID (`br-...`)**:
   Requires `--expected-branch production` and requires `--expected-branch-id`
   and `--production-branch-id` (`NEON_PRODUCTION_BRANCH_ID`) to be valid
   `br-...` identifiers that match each other.
4. **Exact project ID match across `.neon`, `NEON_PROJECT_ID`, and server GUC**:
   Requires `--expected-project-id` (`NEON_PROJECT_ID`), `.neon` (`projectId`),
   the Neon API response, and the PostgreSQL `neon.project_id` GUC (when
   present) to match `wispy-cell-45340306`.
5. **Direct (unpooled) Neon SSL endpoint**: Rejects `-pooler` hostnames,
   `pgbouncer=true`, non-SSL URLs, and non-Neon / loopback hosts.
6. **Authoritative Neon API verification required (GUC-only fallback forbidden)**:
   Requires `NEON_API_KEY` and a live Neon API v2 verification confirming that:
   - The connected `ep-...` endpoint belongs to the exact expected
     `NEON_PRODUCTION_BRANCH_ID`;
   - The branch name in Neon is `'production'`; and
   - The branch is marked `default: true` or `primary: true` in Neon.
   The GUC-only fallback (`neon-server-guc`) and local CLI fallback are
   strictly forbidden on the production path.
7. **Administrative migration role only**: Rejects `oracle_app` and
   `oracle_migrator` both in the connection URI and in the live session
   (`CURRENT_USER` / `SESSION_USER`).
8. **Password-safe role provisioning, transactional DDL, and §2.5 audit**:
   Verifies safe server logging settings before transmitting
   `ORACLE_APP_PASSWORD` as a `$1` bind parameter, applies
   `0001_oracle_ledger_v1_10.sql` inside `BEGIN ... COMMIT`, runs
   `runLedgerSecurityAudit()` (requiring 0 violations), and verifies a live TCP
   login as `oracle_app` with `DATABASE_URL` unset.

