# execplan-review

This skill forces a deep, end-to-end review before implementation:

- Read the ExecPlan fully (no greps).
- Read all referenced files, then trace contract/data-boundary dependents to find additional impacted files.
- Keep findings pragmatic: report only material, evidence-backed risks.
- Enforce complexity and scope control: reject plan bloat that does not lower delivery risk.
- Verify the plan has enough code contracts (interfaces, data boundaries, invariants, verification) to execute without guesswork.
- If impacted files are missing from the plan, flag them and propose adding those file touchpoints.
- For multiple active plans, determine whether they are coupled and must be reviewed in tandem.
- Produce a confidence rating (0-100%).
- If `<95%`, propose lowest-friction fixes with explicit tradeoffs (risk reduced vs added complexity); if `>=95%`, state `Proposals: none`.

Install (Codex):

```bash
npx skills add https://github.com/Skarian/codex-skills/tree/main/project --skill execplan-review -a codex -y
```

Install (Claude Code):

```bash
npx skills add https://github.com/Skarian/codex-skills/tree/main/project --skill execplan-review -a claude-code -y
```
