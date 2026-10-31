# src

## Overview

Library code for the league assistant, split by whether it does I/O. `engine/` is pure logic. `sources/` loads, parses, validates and stores data. The one import across the line is `CATEGORIES`, which `engine/bakeoff.mjs` and `engine/needs.mjs` take from `sources/yahoo-pages/common.mjs`, a module with no I/O. Scripts in [`../scripts/`](../scripts/README.md) wire the two together.

## Subdirectories & Boundaries

- engine: [`./engine/README.md`](./engine/README.md) - Pure planning and scoring: the week planner, the per-category win model, projections, season values, drop guardrails, preferences and shadow-log replay. No I/O.
- sources: [`./sources/README.md`](./sources/README.md) - ESPN fetching and parsing, the read-only Yahoo URL allow-list, snapshot validation, game-log loading with hash checks, and decision and shadow-log storage. Yahoo page parsers are in [`./sources/yahoo-pages/README.md`](./sources/yahoo-pages/README.md).
