# Validate

Use this workflow when a direction exists but its demand, customer, differentiation, or feasibility is uncertain.

## Process

1. Restate the idea as one customer, one painful job, and one promised outcome.
2. Separate user claims from verified evidence.
3. Map current workarounds, direct competitors, adjacent alternatives, and the option to do nothing.
4. Identify the assumptions that would invalidate the project if false.
5. Gather primary and current evidence for the highest-risk assumptions.
6. Design the smallest test that can change the decision without building the full product.
7. Use [decisions.md](decisions.md) for the target and action, with confidence and evidence coverage. Validation normally supports a next test, not an unconditional build.

## Validation Tests

Prefer tests that expose behavior rather than compliments:

- observed workflow or problem interview
- commitment to a follow-up, pilot, deposit, letter of intent, or data access
- concierge delivery of the promised outcome
- landing page with a defined acquisition channel and conversion threshold
- prototype task completion with target users
- technical spike for a genuinely uncertain dependency

## Required Output

- concrete idea statement
- customer and job hypothesis
- alternatives and comparable projects
- supporting and contradictory evidence
- ranked risky assumptions
- test protocol, sample, metric, threshold, and deadline
- decision and confidence

Rank assumptions by consequences if wrong, evidence weakness, and test cost. Link each experiment to an assumption and its evidence. Demand, feasibility, and economics require separate proof; repeated summaries of one interview are not independent observations.

Specify target participants, recruitment channel, current alternative or baseline, metric numerator and denominator, threshold rationale, and outcome actions. Small samples provide learning, not automatic statistical significance. Fit duration to actual budget and the natural usage cycle. Size the sample and promised units to the binding capacity of the days the test actually runs, using the capacity rule in [plan.md](plan.md). Use A/B testing only when randomization, sample size, and data quality support it.

Define three outcomes before the test so every measured result maps to an action:

- **Success:** every stated threshold and prerequisite passes; only then continue.
- **Measured miss:** valid data shows any threshold or prerequisite unmet. Name the unmet condition. One explicit stop/revise fallback covers every such combination, including near misses; leave no measured range between success and stop without an action, and do not call a measured shortfall inconclusive.
- **Inconclusive:** only when valid data is genuinely insufficient to measure a criterion, such as too few eligible observations or broken instrumentation.

Keep the user's stated thresholds unless you explain a change. Any retry or further evidence-gathering must fit the user's remaining time and budget; label a longer or costlier extension as an option needing additional resources, not as authorized.

Load [product-market-fit.md](product-market-fit.md) for value, behavior, retention, payment, or scaling decisions. Load [ai-product-validation.md](ai-product-validation.md) when AI quality, cost, or automation risk changes the decision.

Never present a top-down market estimate as customer validation. Never treat the absence of a discovered competitor as proof of an open market.
