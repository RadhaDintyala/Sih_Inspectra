# Decision Log — SIH 26034

## D001 — Product is an inspection assistant

Decision:
The system assists enforcement officers; it does not replace legal judgment.

Reason:
This keeps uncertain image/OCR cases safely reviewable.

## D002 — Deterministic compliance engine

Decision:
Compliance rules are explicit/versioned rather than hidden inside an LLM prompt.

Reason:
Legal requirements need traceability and reproducibility.

## D003 — PASS / FAIL / REVIEW

Decision:
Use three primary outcomes.

Reason:
OCR and physical measurements can be uncertain.

## D004 — Evidence is first-class data

Decision:
Every important finding stores evidence location/reference.

Reason:
A judge should be able to ask "why?" and immediately see the source.

## D005 — Real product photos over synthetic dashboards

Decision:
The hero demo uses real packaging.

Reason:
The judge can immediately understand the problem and test the concept.

## D006 — UI is an enforcement instrument

Decision:
Visual polish supports information hierarchy rather than decoration.

Reason:
A beautiful enforcement tool should still feel trustworthy and fast.

## D007 — Prototype scope

Decision:
Skip authentication and nonessential administration during the initial internal prototype.

Reason:
The PS requires them for the full solution, but they are not the highest-value proof during the first build sprint.

## D008 — Model routing

Decision:
Agents are assigned by capability, not hardcoded model names.

Reason:
Model availability and pricing change; the orchestration policy should remain stable.

## D009 - YOLO deferred

Decision:
Do not introduce YOLO in the prototype extraction path yet.

Reason:
The repository has no YOLO/Ultralytics implementation, labelled declaration-region dataset, or measured localization bottleneck. Gemini structured extraction plus evidence regions is the current tested path. A detector can be added behind the extraction adapter when labelled data demonstrates that it improves region localization.
