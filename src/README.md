# src

## Overview

Library code for the league assistant, split by whether it does I/O. `engine/` is pure logic, including the facts sheet. `sources/` loads, parses and validates data. The one import across the line is `CATEGORIES`, which `engine/needs.mjs` takes from `sources/yahoo-pages/common.mjs`, a module with no I/O. Scripts in [`../scripts/`](../scripts/README.md) wire the two together.

## Subdirectories & Boundaries

- engine: [`./engine/README.md`](./engine/README.md) - Pure logic: the facts sheet builder, the lineup and category model it uses, season values, the role-change watch list, the shooting-volume estimate, and date and name helpers. No I/O.
- sources: [`./sources/README.md`](./sources/README.md) - ESPN fetching and parsing, the read-only Yahoo URL allow-list, snapshot validation, game-log loading and refresh, and per-page parsing for the sheet. Yahoo page parsers are in [`./sources/yahoo-pages/README.md`](./sources/yahoo-pages/README.md).
