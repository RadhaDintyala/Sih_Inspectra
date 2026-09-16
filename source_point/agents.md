# Agents.md — SIH 26034 Agent Orchestrator

## Mission

Coordinate coding agents by capability. The orchestrator must optimize for **shipping a complete, tested product**, not generating more planning documents.

## Routing

| Work | Agent profile | Output |
|---|---|---|
| Architecture | strongest reasoning/coding model | implementation decisions + interfaces |
| Frontend | strongest frontend-capable model | production UI |
| OCR/CV | strongest vision/ML model | extraction pipeline |
| Compliance engine | strongest reasoning model | deterministic rule checks |
| Backend/data | strongest coding model | APIs + persistence |
| QA | independent model | bugs, edge cases, tests |
| Design critique | visual/design-capable model | concrete UI fixes |
| Final integration | strongest coding model | merged working system |

Model names should be selected from the currently available gateway/models rather than hardcoded into this file.

## Orchestration rules

1. Inspect existing code before changing it.
2. Work from the shared documents.
3. Do not duplicate another agent's work.
4. Never fabricate completed work.
5. Never mark a task complete without running the relevant checks.
6. Prefer small, reversible commits.
7. If an agent discovers a contradiction, stop and update `decision_log.md`.
8. Never allow an LLM to silently invent legal requirements.
9. Agents must return:
   - files changed
   - what works
   - tests run
   - known limitations
   - next dependency

## Parallel work

Safe parallel lanes:
- UI shell
- OCR adapter
- compliance engine
- database/schema

Integration must happen through documented interfaces, not by editing the same files simultaneously.

## Priority order

P0 = end-to-end scan → extraction → compliance → result

P1 = evidence annotation, history, report export

P2 = dashboard, batch inspection, advanced analytics

P3 = authentication/roles, deployment hardening, nonessential polish

If time is limited, finish P0 before touching P2/P3.
