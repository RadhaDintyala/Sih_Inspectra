# Animations.md — Motion Direction

## Product character

This is an enforcement/inspection tool. Motion should feel **precise, calm and instrument-like**, not playful.

## Signature motion

The main scan interaction should feel like an inspection instrument:

**Capture → image lock → processing sweep → detected fields appear → compliance verdict resolves.**

Use one orchestrated sequence rather than many unrelated animations.

## Allowed

- image/scan acquisition transition
- OCR bounding-box reveal
- field extraction highlight
- rule-by-rule verdict reveal
- subtle progress/state transitions
- hover/focus feedback
- report generation confirmation
- expandable evidence panels

## Avoid

- bouncing cards
- excessive parallax
- continuous decorative movement
- animated gradients everywhere
- long splash screens
- animation on every card
- motion that delays a task

## Accessibility

Respect `prefers-reduced-motion`.

Motion must never be the only way information is communicated.

## Timing

Use short, intentional transitions. Do not fake processing for several seconds when the computation is already complete.

If a real operation takes time, show its actual state.
