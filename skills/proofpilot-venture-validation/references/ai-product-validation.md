# AI Product Validation

Load when an AI workflow's quality, reliability, delivery cost, or automation boundary materially affects discovery, validation, planning, or review. Do not require this module for an unrelated task merely because a project mentions AI.

## Define What The Customer Accepts

Identify the buyer, actual task, input conditions, acceptable outcome, and who can judge acceptance. Separate product demand from technical capability: neither a persuasive demo nor a model benchmark establishes willingness to pay.

Compare a narrow AI workflow with the customer's current approach and a simpler feasible alternative, such as manual delivery, rules, or one model call. Choose the comparison that tests the proposed advantage; do not build a multi-agent system to validate a job that can be delivered and measured manually.

Sequoia's [Services: The New Software](https://sequoiacap.com/article/services-the-new-software) proposes selling completed work and looking at already-outsourced tasks for a buyer and budget. Treat this as an optional discovery thesis. Verify the actual purchaser, current spend, acceptance process, and constraints. An existing outsourcing market does not prove that an AI service can win it, deliver it profitably, or operate autonomously.

## Run A Small, Representative Evaluation

- Select varied, permitted tasks and consequential failure cases; label synthetic inputs. Reserve unseen cases for evaluation after tuning.
- Define acceptance and material failures beforehand. Verify actual outcomes with deterministic checks or qualified human judgment. Calibrate model judges against human-reviewed examples.
- Compare candidate and baseline on the same tasks and comparable conditions. Repeat trials where variability matters; separate task counts from trial counts. Show acceptance counts and failure categories.
- Measure time to acceptance, including waiting and corrections, plus timeouts, retries, abandoned tasks, and human intervention. Report typical and slow-case latency where supported; retain failed trials.
- Record model/version, workflow, data snapshot, grading criteria, and run dates. Turn diagnosed failures into regression cases; keep fresh held-out cases for final evaluation after material changes.

These procedures adapt [Anthropic's evaluation guide](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents). Scale effort to the decision and error cost; state uncertainty in small pilots.

## Calculate Cost Per Accepted Outcome

For the same measured batch:

`cost per accepted outcome = total variable delivery cost of all attempted tasks / accepted outcomes`

Include model calls, tools and data, variable infrastructure, retries, human checking, repairs, and attributable support. Include spending on failures in the numerator; count each final accepted task once in the denominator. If nothing is accepted, report zero accepted outcomes and the incurred cost rather than a finite unit cost.

State the currency, sample counts, labor-rate assumptions, and missing cost components. Unpaid founder checking has a time cost: record it and show a reasonable replacement-cost scenario. Keep fixed development cost separate from variable delivery cost, and distinguish acquisition cost from delivery cost. Compare collected price after discounts/refunds with the same unit of delivery.

Separate AI-only acceptance from acceptance after human repair. Model plausible changes in intervention, input size, and usage mix; do not project today's best demonstration cost onto every production task. A cheap model call can still produce an expensive accepted result.

## Set The Operating Boundary

Specify which failures the system detects, when it abstains or escalates, who handles the fallback, and whether that path still meets the service promise. Where errors can materially affect health, legal rights, finances, or other consequential decisions, check the current applicable requirements and preserve necessary qualified human responsibility. A commercial thesis does not remove licensing obligations or authorize autonomous consequential actions.

Use the existing [safety.md](safety.md) boundaries for data, tools, and external effects. Evaluation inputs must not expose private customer data to unapproved services. A successful controlled evaluation supports only the tested scope; it does not authorize production deployment.

Return the measured advantage or unresolved gap, acceptance and failure evidence, cost per accepted outcome, operating boundary, and the smallest next comparison. Use the shared recommendation contract; if results only justify another test, do not describe them as build, scale, or application readiness.

## Sources

- [Services: The New Software](https://sequoiacap.com/article/services-the-new-software), Julien Bek / Sequoia, published 2026-03-05; checked 2026-09-05. Optional commercial thesis, not evidence of this product's demand or safety.
- [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents), Anthropic, published 2026-01-09; checked 2026-09-05. Task/trial separation, observable outcomes, evaluation methods, and regression discipline.
