---
name: execplan-review
description: Use when the user requests a review of the ExecPlan.
---

# ExecPlan Review

Trigger: use when the user requests a review of the ExecPlan.

Now that you have put together the execplan, please spend some time reviewing it end to end (full file, no greps). Review all source code files directly referenced by the execplan, then discover additional impacted files by tracing changed contracts/interfaces/data boundaries to immediate dependents.

Once you have reviewed all relevant files (and don't be shy, I expect you to use all your context window in this review), rate your confidence in the ability for you to execute the execplan as-is without intervention.

Consider factors like if the plan unintentionally introduces bugs, bad side-effects, if we need to reconsider our approach from first principles, any potential AI drift / slop.

Calibrate for pragmatism:

- Include only material, evidence-backed risks that are likely to cause regressions, blocked execution, or significant rework.
- Do not list speculative or low-value cautions that add process friction without a clear risk payoff.
- Prefer the smallest set of findings needed to execute safely.

Complexity and scope control:

- Only propose added plan structure when it clearly reduces a named delivery risk tied to acceptance criteria, correctness, or rollback safety.
- Reject additions that increase plan surface area (more moving parts to coordinate) without lowering the probability or impact of failure.
- Confidence is about executability of current contracts, not document length, milestone count, or added structure.
- Do not add complexity solely to increase confidence.
- Examples to reject: splitting one tightly coupled change into multiple ExecPlans, adding optional modes or extension hooks not required by acceptance criteria, broad refactors outside requested behavior, extra review gates that do not reduce defect or rollback risk, and helper artifacts that are not part of the delivered system.

Before assigning confidence, verify the ExecPlan includes enough code contracts for reliable execution without guesswork. At minimum, check for:

- Concrete file/module touchpoints
- API/function/interface boundaries expected to change
- Data shapes/schema expectations at boundaries
- Invariants and error-handling expectations
- Verification steps that prove those contracts are satisfied

If impacted files are missing from the ExecPlan:

- Flag each missing file as a finding.
- Propose adding those file touchpoints to the ExecPlan.
- For every non-referenced file included in review, state the concrete reason (shared contract, call path, schema boundary, or test coverage impact).
- Do not expand further unless a material risk remains unverified.

If multiple active ExecPlans exist, evaluate whether they must be reviewed together:

- Enumerate active plans from `.agents/execplans/INDEX.md` before deciding coupling.
- Split into multiple ExecPlans only when there are independent acceptance criteria, independent rollout/rollback boundaries, or independently shippable outcomes.
- If active ExecPlans share files, contracts/interfaces, or dependency order, review and reason about them in tandem as one system.
- If active ExecPlans are independent, review them independently to avoid unnecessary cross-plan coordination.
- When plans are coupled, require each plan's `Context and Orientation` section to list related Plan IDs, shared contracts/interfaces, and required execution order.

Provide your confidence rating on a scale of 0-100%, if the rating is below 95% then you must provide a list of proposals to bridge the gap or propose rejecting the execplan in its entirety

Output format (use this):

- `Confidence: <N>%`
- `Key risks (numbered, material-only): ...`
- `Code-contract gaps (numbered): ...`
- `Split recommendation: none | required (why)`
- `Cross-plan coupling: none | present (plans/contracts/order)`
- `Proposals if <95% (numbered, lowest-friction-first): ...`
- `If confidence >=95%: Proposals: none`
- `Proposal complexity cost: N/A when there are no proposals; otherwise low | medium | high per proposal`
- For each proposal, include: risk reduced, added complexity, and why the tradeoff is net-positive.
- For numbered findings/proposals, put each bullet on its own line; never combine multiple bullets onto one line.
