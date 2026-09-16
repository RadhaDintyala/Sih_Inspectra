# Project Structure — Recommended

The exact framework can be chosen by the implementation team. Keep the boundaries below.

```text
sih-26034/
├── docs/
│   ├── ps_requirements.md
│   ├── userpov.md
│   ├── ui_ux_requirements.md
│   ├── architecture.md
│   ├── data_contract.md
│   ├── compliance_rules.md
│   ├── skills.md
│   ├── animations.md
│   ├── agents.md
│   ├── tools.md
│   ├── testing_strategy.md
│   ├── demo_script.md
│   └── decision_log.md
├── apps/
│   └── web/
├── packages/
│   ├── compliance-engine/
│   ├── extraction/
│   ├── shared/
│   └── reporting/
├── data/
│   ├── samples/
│   └── rules/
├── tests/
├── scripts/
├── .env.example
├── AGENTS.md
└── README.md
```

## If the team chooses a simpler monorepo

Do not create packages merely for the sake of architecture. The minimum useful boundaries are:

- UI
- API
- extraction
- compliance engine
- persistence
- tests

Keep the compliance engine independently testable.
