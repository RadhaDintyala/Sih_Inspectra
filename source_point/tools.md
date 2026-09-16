# Tools.md — SIH 26034

## Goal

Use tools that are free/open-source or have a usable free tier, are mature enough for a hackathon, and can be replaced without rewriting the product.

## Core

| Tool | Purpose | Policy |
|---|---|---|
| Node.js | Runtime | Required |
| TypeScript | Type safety | Required |
| Next.js / React | Web application | Preferred |
| Tailwind CSS | Styling | Preferred |
| shadcn/ui | Base components | Use selectively; do not let defaults dictate the design |
| Zod | Runtime validation | Required at API/data boundaries |
| PostgreSQL | Persistent inspection data | Preferred |
| Git + GitHub | Version control | Required |
| Playwright | Browser/E2E testing | Preferred |
| Vitest | Unit tests | Preferred |

## Computer Vision / OCR

Primary candidates:
- PaddleOCR
- Tesseract
- OpenCV

Selection rule:
- Prefer a local/open implementation for the prototype.
- Benchmark on actual packaging photos before committing.
- Do not assume OCR accuracy from clean document scans.
- Keep OCR behind an adapter so the engine can be swapped.

## Reporting

Use a browser-printable report first. Add PDF generation only after the inspection result is stable.

## Maps / visualisation

Only use mapping if it contributes to enforcement workflow. Do not add a map just to make the dashboard look sophisticated.

## Development

- Use browser DevTools.
- Use Lighthouse/Accessibility checks where useful.
- Run typecheck + lint + tests before claiming completion.

## AI / LLM policy

LLMs may assist with unstructured interpretation, but the final compliance verdict must be grounded in explicit rules and extracted evidence.

**Never let an LLM invent a legal requirement.**

## Secrets

- `.env.local` for local secrets.
- `.env.example` contains names only.
- Never commit API keys, tokens, credentials or private datasets.

## Tool-selection rule

Prefer the simplest reliable tool that solves the problem. Avoid adding dependencies because an agent thinks they are "cool".
