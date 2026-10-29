# League refresh verification map

| Feature | User entry points | Proof |
|---|---|---|
| [Capture](capture.md) | update league; league-refresh step 1 | Browser-runtime write test and all nine unchanged saved page reads |
| [Analysis](analysis.md) | npm run refresh:analyze; individual diagnostic CLIs | Final summary plus new immutable decision and evidence |
| [Brief](brief.md) | npm run brief; briefing clipboard step | Exact selected decision, state note and generated file; clipboard comparison |
| [Review](review.md) | npm run review with ID; reopen without ID; reload/select/copy/rate | Rendered state and saved events/ratings; isolated HTTP smoke covers only backend subset |

Start with Doctor in ../SKILL.md. Check every applicable entry point when claiming full coverage.
One mapped feature suffices to validate installation of this skill; it does not prove a full refresh.
Pilot comparison and vault logging remain optional scope decisions, not covered by the smoke helper.
