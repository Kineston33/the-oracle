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
| One-off migration / audit (`src/server/migrate.ts`) | `ORACLE_APP_PASSWORD` *(caller-supplied)* | Optional | Password assigned to the `oracle_app` login role during migration |
| GitHub Actions CI (`.github/workflows/postgres-ci.yml`) | `TEST_DATABASE_ADMIN_URL` | Set by CI workflow | Ephemeral connection string pointing to the per-run `postgres:16` Docker service container in GitHub Actions |
| GitHub Actions Neon PR workflow (`.github/workflows/neon-workflow.yml`) | `vars.NEON_PROJECT_ID` | Required in GitHub Actions | Repository variable storing the Neon project ID (`wispy-cell-45340306`) |
| GitHub Actions Neon PR workflow (`.github/workflows/neon-workflow.yml`) | `secrets.NEON_API_KEY` | Required in GitHub Actions | Repository secret storing the Neon API key used to create and delete temporary PR branches |

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

### Workflow lifecycle and guarantees

- **Branch creation / reuse (`opened`, `reopened`, `synchronize`)**:
  - Computes an RFC 3339 UTC timestamp 14 days in the future
    (`date -u --date '+14 days' +'%Y-%m-%dT%H:%M:%SZ'`) and passes it as
    `expires_at` to `neondatabase/create-branch-action@v6`.
  - Creates (or reuses on `synchronize` / `reopened`) a branch named
    `preview/pr-<number>-<head_ref>`.
  - Masks sensitive step outputs (`password`, `db_url`, `db_url_pooled`) in the
    runner log stream via `::add-mask::` and exposes only non-sensitive job
    outputs (`branch_id`, `created`, `db_host`, `db_host_pooled`) bound directly
    to `steps.create_neon_branch.outputs.*`.
- **Branch deletion (`closed`)**:
  - Deletes `preview/pr-<number>-<head_ref>` via
    `neondatabase/delete-branch-action@v3` when the pull request is closed or
    merged. If deletion is skipped for any reason, the 14-day `expires_at` TTL
    guarantees automatic cleanup in Neon.
