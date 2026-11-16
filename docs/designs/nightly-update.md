# Nightly update

*   **Status:** Proposed. Not built.
*   **Date:** 2026-11-15

## Overview

Tony wants the advice on his phone each night without asking for it. Every add is a waiver claim
that processes after 1 a.m. Pacific, so the advice has to arrive after the night's games and
before the claim deadline, usually midnight Pacific. This note settles where the run happens, when
it starts, how it reads Yahoo and how Tony receives the result.

## Decisions

- **Where it runs.** A scheduled task in the Claude desktop app on Tony's PC. It runs daily at
  10:15 p.m. Pacific and runs the `update-league` skill.
- **When it starts.** The facts sheet header says whether every game is final. If a game is not
  final, the run checks again every 15 minutes until 11:15 p.m. Then it runs anyway and names the
  games that were not final.
- **Deadline.** Advice is delivered by 11:30 p.m., 30 minutes before the claim deadline.
- **How it reads Yahoo.** Through Claude in Chrome, so Chrome must be open and signed in. When it
  is not, the run sends "signed out, no advice tonight" instead of nothing.
- **Delivery.** The advice file by `SendUserFile`, plus a push notification carrying the three
  headline lines (`HEADLINE`, `Move`, `Why`).
- **Rescues.** A missed night counts as a rescue.

## Status

Creating the scheduled task needs Tony's OK. Nothing is scheduled yet.

## Open questions

- Permission prompts in an unattended run. A prompt with nobody there stops the run.
- The PC being asleep at 10:15 p.m.
- Whether a MetaMuse relay delivers the update, and how it can receive one.

## Done when

Tony receives an update on three nights in a row without a rescue.
