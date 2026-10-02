---
name: proofpilot-mvp-planner
description: Use when scoping the smallest useful MVP or experiment with milestones, dependencies, measurement, and a demo, or routing an explicit Solana implementation request from an existing specification.
---

# ProofPilot MVP Planner

This optional profile selects the `plan` stage of the shared ProofPilot workflow.

## Support Bundle

The default installation includes 36 supporting skills and shared guidance. For a standalone copy or incomplete install, follow [installation.md](references/installation.md): check the portable helper on first use for actual work and install missing support unless core-only or no-install was selected. Inventory-only requests remain read-only. Then continue the user's original task.

For Solana capability questions or explicit coding/testing requests, first follow the shortcuts in [solana-new.md](references/solana-new.md). Local inventory and implementation from an existing specification need no account setup. Continue with the host agent if developer skills are absent; use the venture workflow below only when the user requests venture work.

For research, first read [onboarding.md](references/onboarding.md). Colosseum access is required for completed ProofPilot setup in this profile too. Check existing official Copilot Connect access, verify the current V2 evidence grant, and guide browser/device sign-in if needed; keep the original task pending. Other keys are optional. Apply the explicit limited/offline-work exception from that reference.

1. For substantial assessments, follow [quality.md](references/quality.md) from frozen evidence through checks and bounded repair, even for prose output and on every model. Read [routing.md](references/routing.md), [decisions.md](references/decisions.md), [evidence.md](references/evidence.md), and [safety.md](references/safety.md). Classify mode, stages, domains, venture type, program context, and sensitivity independently.
2. Follow [plan.md](references/plan.md). Add another stage only when the user's request needs it. Ask at most three questions when they materially change the decision; otherwise state assumptions and continue.
3. Start relevant project/archive research with Colosseum, then select the smallest useful complementary source set from [source-registry.json](references/source-registry.json) and applicable [source-playbooks.json](references/source-playbooks.json). Check actual availability and current official facts. Read [source-orchestration.md](references/source-orchestration.md) for local discovery or nested skills.
4. For validation or readiness, apply [honest-evaluation.md](references/honest-evaluation.md). Use [rubrics.json](references/rubrics.json) for scoring, with supported scores and evidence coverage; never substitute tone for rigor.
5. Load [accelerators.md](references/accelerators.md), [presentations.md](references/presentations.md), or [solana-new.md](references/solana-new.md) only when relevant. Load [product-market-fit.md](references/product-market-fit.md) for value, retention, monetization, scaling, or Sequoia; [ai-product-validation.md](references/ai-product-validation.md) when AI quality, economics, or automation materially affects the decision.
6. Return the checked stage output and next defensible decision; disclose unresolved material checks from [quality.md](references/quality.md). Narrow edits need only relevant accuracy/format checks. For structured output use [response.schema.json](references/response.schema.json) and resolve `scripts/validate-response.js` from this installed profile's directory.

Match the delivery model to the riskiest assumption. Use the focused PMF and AI references when their measurement or delivery risks matter.

Respect the user's actual business goal and existing scoped authorization. Local drafts and requested reversible edits are within the task; external writes, payment, deployment, signing, or submission require authorization covering that action. Pass these bounds into delegated tools.
