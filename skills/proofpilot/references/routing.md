# Routing

Classify the request across independent dimensions. Do not force the project into one exclusive track.

## Modes

- `coach`: discover, improve, plan, or prepare work with the user
- `evaluator`: apply a fixed rubric to submitted artifacts for judging, ranking, or formal review

Never combine coaching edits and a formal score in the same evaluation pass.

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
