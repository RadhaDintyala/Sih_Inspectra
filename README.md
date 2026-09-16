# INSPECTRA — Food Package Inspection & Legal Metrology Compliance Platform

Production-grade inspection system for **Indian Legal Metrology (Packaged
Commodities) Rules, 2011**. No generative AI anywhere on the official
inspection path.

## Architecture

```
CLIENT (PWA: camera + evidence + result UI)
  │ HTTPS
API (Next.js — stateless: auth/RBAC, inspection + evidence endpoints)
  │                │
  ▼                ▼
PostgreSQL      Object storage (S3/MinIO, local-vault fallback)
(Prisma)             ▲
  │            evidence truth
Redis (job queue)    │
  │                  │
ANALYSIS WORKER(s) ──┘  (horizontally scalable, `npm run worker`)
  gate → YOLO → regional OCR → validators → compliance engine → DB
```

Pipeline truth table: **DB** = persistent truth · **object storage** =
evidence truth · **YOLO/layout-CV** = visual location · **Tesseract OCR** =
text recognition · **validators** = declaration interpretation ·
**compliance engine** = statutory evaluation · **frontend** = presentation.

Key guarantees:

- **Package presence gate first.** Faces, walls, and empty frames yield
  `INVALID_EVIDENCE` with capture guidance — never a compliance analysis.
- **No compliance score for invalid evidence.** Score is `NULL`
  ("unavailable"), never an invented 50/100.
- **Every bounding box is measured.** Trained YOLO weights when
  `ml/weights/best.pt` exists, otherwise classical layout analysis
  (projection-profile bands + package-gate content rect). No placeholders.
- **Multi-photo first-class.** Every frame is its own evidence record with
  ID, checksum, dimensions, order, and processing state; fields aggregate
  across frames with source tracing and conflict detection.

## Run locally

Prerequisites: Node 20+, Homebrew (macOS) or system Postgres/Redis.

```bash
# 1. Services (or: docker compose up db redis storage)
brew services start postgresql@16
brew services start redis

# 2. Configure
cp .env.example .env   # defaults target local Postgres + Redis

# 3. Database
npx prisma migrate deploy
npm run seed            # orgs, RBAC users, LM-PC-01..07 rules

# 4. API + worker(s)
npm run dev             # http://localhost:3000
npm run worker          # repeat in N terminals to scale

# 5. Health
curl "http://localhost:3000/api/health?deep=true"
```

Seeded logins: `officer` / `officer123` (Delhi), `admin` / `admin123`,
`reviewer` / `reviewer123`, `officer_maha` / `officer123` (Maharashtra).

Or run the full stack in Docker:

```bash
docker compose up --build            # api + worker + postgres + redis + minio
docker compose up --scale worker=3   # scale the analysis fleet
```

## Verify

```bash
npm test            # unit + integration (real OCR, Postgres) — 73 tests
npm run build       # production build
npx playwright test # E2E: login → capture → queue → worker → verdict → report
```

## Train a custom YOLO model (optional)

`ml/` ships the full interface: `dataset/` (`data.yaml`, `classes.txt`),
`training/train.py`, `inference/yolo_detector.py`, `validation/`,
`weights/` (drop `best.pt` + update `model_meta.json` — the pipeline picks
it up automatically and reports it in health + detection records).
