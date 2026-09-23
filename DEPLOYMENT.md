# Deployment Guide

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL (e.g. Neon, Supabase, Render Postgres) |
| `SESSION_SECRET` | No | `inspectra-secret-key...` | Tamper-proof HMAC secret key for signed session cookies |
| `SCAN_STORE_DIR` | No | `.scan-store` | Relative/absolute directory for local file storage fallback |

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

## Running Locally

```bash
npm install
npm run dev
# App at http://localhost:3000
```

## Docker

### Dockerfile

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
```

### Build and run

```bash
docker build -t inspectra .
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -v inspect-store:/app/.scan-store \
  inspectra
```

### Using docker-compose

```yaml
services:
  inspectra:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
    volumes:
      - scan-store:/app/.scan-store

volumes:
  scan-store:
```

```bash
docker compose up -d
```

## Persistent Storage

Inspection records are saved as JSON files in `SCAN_STORE_DIR` (default `.scan-store/`). Mount a volume to persist data across container restarts:

```bash
# Named volume (recommended)
docker run -v inspect-store:/app/.scan-store ...

# Bind mount (for backups / local dev)
docker run -v /host/path/scan-store:/app/.scan-store ...
```

Without a volume, all inspection records are lost when the container stops.

## Production: Moving to a Real Database

The file-based store (`src/services/store.ts`) is a prototype convenience. For production, replace it with a proper database.

### What changes

1. **`src/services/store.ts`** — Rewrite `saveInspection()`, `getInspection()`, `listInspections()` to use a database client instead of `fs.readFileSync`/`fs.writeFileSync`. The function signatures stay the same; callers don't change.

2. **Schema** — Create a table/collection for `Inspection` records. The JSON structure in `src/domain/inspection.ts` (`Inspection` type) maps directly to columns or a document schema. Key fields to index: `id` (primary), `createdAt`, `status`.

3. **Environment** — Add a `DATABASE_URL` env var (e.g., Postgres connection string, MongoDB URI). Remove or ignore `SCAN_STORE_DIR`.

4. **Migration** — For existing data, write a one-off script that reads `.scan-store/*.json` and inserts each record into the database.

### Recommended stack

| Option | Why |
|--------|-----|
| **PostgreSQL + Prisma** | Type-safe queries, migrations, well-supported on Next.js |
| **MongoDB + Mongoose** | Natural fit for the JSON `Inspection` shape |
| **SQLite + Drizzle** | Zero-config for single-node deployments |

The change is isolated to `store.ts` — no other files need modification.

## Authentication & Dual-Portal Architecture

Inspectra uses a real credentialed dual-portal system backed by Prisma SQLite (`User` model) with secure password hashing (PBKDF2-SHA512, 100k rounds, 16-byte random salt) and tamper-proof HMAC-SHA256 signed session tokens stored in `HttpOnly`, `SameSite=Lax` cookies (`inspectra_session`).

Client-side role switching is completely removed. User roles (`officer` vs `admin`) are strictly determined and verified server-side on every request and route transition via Next.js Middleware (`src/middleware.ts`) and API route handlers (`src/services/auth.ts`).

### Seed Demo Accounts

The database is seeded with two distinct portal accounts via `npx tsx prisma/seed.ts`:

| Portal Role | Username | Password | Post-Login Primary View | Permissions |
|-------------|----------|----------|-------------------------|-------------|
| **Field Officer** | `officer_demo` | `Inspectra@Officer2026!` | **Real-Time Scanning & Inspections** (`/`) | Live camera capture, upload analysis, offline OCR fallback, PDF generation, viewing history |
| **Senior Administrator** | `admin_demo` | `Inspectra@Admin2026!` | **Dashboard Analytics & Rules Engine** (`/`) | Compliance analytics overview, full rules engine administration (edit, toggle, delete rules), audit logs |

> **Note**: Seed credentials are intentionally documented here only and never exposed in client bundles or UI source code.

### Role Enforcement & Server-Side Security

1. **Middleware Gating**:
   - Protected Admin API endpoints (`DELETE /api/rules/[id]`, rule mutation operations) verify the HMAC-signed session cookie in Next.js Edge middleware.
   - Unauthenticated requests return `401 Unauthorized`.
   - Authenticated Officer requests attempting Admin actions return `403 Forbidden`.

2. **Differentiated Experiences**:
   - **Officer Portal**: Optimized for field inspections. Landing screen opens directly to the Scan workflow (Live Camera, File Upload, Offline Tesseract OCR) with high-legibility findings and statutory gazette citations.
   - **Admin Portal**: Optimized for regulatory oversight. Landing screen opens to executive compliance metrics, rule distribution charts, and statutory rule management console.

