# Routing

Classify the request across independent dimensions. Do not force the project into one exclusive track.

## Before Venture Classification

For a question about available Solana skills, use the local capability inventory in [solana-new.md](solana-new.md). Distinguish default support dependencies, actually found skill files and any missing skills. Skip venture intake and account setup for this lookup.

For explicit Solana coding, debugging, or testing, follow that reference's implementation route. Use the existing solution/specification as input and produce the requested code and verification. Do not force this task through `discover`, `validate`, or a planning-only response. Optional developer skills can help, but the host agent can proceed without them. Apply the normal venture stages only to venture work the user actually requested.

## Modes

- `coach`: discover, improve, plan, or prepare work with the user
- `evaluator`: apply a fixed rubric to submitted artifacts for judging, ranking, or formal review

Never combine coaching edits and a formal score in the same evaluation pass.

For hackathon/workshop scoring, event-rubric design or participant self-review, route to [event-assessment.md](event-assessment.md) at the `review` stage. Infer organizer/judge/participant role and choose published/custom rules or a matching ProofPilot preset. The event scorecard has its own event context; do not force a workshop into the venture response taxonomy. An event assessment does not automatically trigger demand validation or accelerator research.

## Stages

Run stages in this order when more than one applies:

1. `discover`: the user has no sufficiently concrete direction
2. `validate`: the user has a direction but lacks proof that the problem or demand is real
3. `plan`: the direction is chosen and needs an MVP, experiment, stack, timeline, or demo path
4. `review`: an artifact or project needs readiness findings or a formal score
5. `submit`: the user needs a pitch, grant, accelerator, competition, or hackathon package

A broad request such as "find an idea, check it, and plan an MVP" requires `discover`, `validate`, and `plan` rather than one focused stage.

## Other Dimensions

Read [taxonomy.json](taxonomy.json) for allowed values.

- Select multiple `domains` when needed.
- Select one primary `venture_type`; record secondary characteristics as assumptions.
- Select the named `program_context`, or `none` when no external program drives the work.
- Set `sensitivity` before sending any user material to an external source.

## High-Impact Intake

Gather only information that changes the recommendation:

- access: which users, industries, communities, or distribution channels can the founder reach?
- capacity: skills, team, budget, tools, and time horizon
- outcome: learning, revenue, grant, hackathon, accelerator, public good, or internal use
- constraints: geography, regulation, privacy, required ecosystem, or deadline
- existing proof: interviews, usage, revenue, waitlist, prototype, repository, or prior feedback

If the user does not know an answer, record it as unknown and continue with a reversible next step.

## Examples

| Request | Mode | Stages | Domains | Program Context |
|---|---|---|---|---|
| "I do not know what business to start" | `coach` | `discover`, `validate` | infer after intake | `none` |
| "Validate my AI CRM idea and plan a two-week MVP" | `coach` | `validate`, `plan` | `ai`, `web2` | `none` |
| "Prepare this Solana project for Colosseum" | `coach` | `review`, `submit` | `web3` | `hackathon` |
| "Score all finalists using the published rubric" | `evaluator` | `review` | project-specific | `competition` or `hackathon` |
| "Turn our offline training service into a grant application" | `coach` | `validate`, `plan`, `submit` | `physical_world`, `community` | `grant` |
