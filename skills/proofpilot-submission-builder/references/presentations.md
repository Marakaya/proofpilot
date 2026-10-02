# Presentation Decks

Use this reference when the user needs slides, a pitch deck, demo deck, investor deck, angel deck, grant deck, accelerator deck, or presentation review.

Apply `honest-evaluation.md` when giving a readiness verdict. Keep claims faithful to their evidence. A narrow copy or layout edit does not require a full venture assessment.

## Data Files

- `presentation-decks.json`: deck types, slide sequences, required proof, red flags.
- `presentation-checklist.json`: deck-specific review questions; use `rubrics.json` for formal scoring.
- `accelerator-programs.json`: accelerator-specific fit.
- `accelerator-checklist.json`: accelerator-specific review questions.
- `judgment-policy.json`: non-flattering evaluation rule.

## Tooling

Use these existing tools when available:

- `create-pitch-deck`: narrative, HTML pitch deck, scorecard, objection prep.
- `Presentations` plugin: high-quality local PPTX creation/editing.
- `google-slides` skill and Google Drive connector: native Google Slides editing or import.
- `design-taste`: deck style direction.
- `brand-design`: brand palette/logo/system when the project lacks visual identity.

## Deck Selection

Lengths and slide sequences below are ProofPilot defaults, not official program requirements. Use the current requested format first; some programs use forms or videos instead of a deck. Adapt proof requirements to founder-first and pre-product stages.

| Need | Deck Type | Default Length | What Wins |
|---|---:|---:|---|
| Hackathon | `hackathon_demo_deck` | 6-8 slides | Working demo, sponsor/track fit, technical completion. |
| Investors / VC | `investor_seed_deck` | 10-12 slides | Venture-scale story, traction, market, team, ask. |
| Angels | `angel_intro_deck` | 5-8 slides | Founder credibility, clear product, early proof, direct ask. |
| Accelerator | `accelerator_deck` | 7-10 slides | Founder edge, speed, people-want-it proof, program fit. |
| Grant / Partner | `grant_partner_deck` | 8-10 slides | Ecosystem value, milestones, budget, maintenance. |

## Audience Rules

### Hackathon

- Put demo before market theory.
- Show what was built and how it uses the sponsor/ecosystem.
- Keep technical explanation concrete.
- Do not pretend a prototype is a company.

### Investors

- Make the market and wedge credible.
- Show traction or a brutally honest substitute for traction.
- Tie the ask to milestone math.
- Include competition and why now.

### Angels

- Keep it shorter than a VC deck.
- Lead with founder story, product, and immediate proof.
- Make the check size, terms, and use of funds clear.
- Avoid jargon that makes the company feel less real.

### Accelerators

- Use `accelerators.md`.
- Prove founder edge and speed.
- Check the actual program's stage and requirements. Founder-first programs can accept applicants before a product or customer evidence; distinguish formal fit from application strength.

## Output Standards

When reviewing or drafting:

- pick the deck type
- state the audience
- give a readiness verdict when requested or needed for the decision
- list missing proof
- produce the slide sequence
- write slide titles in plain language
- flag weak slides
- prepare hard Q&A

When building actual files:

- use `create-pitch-deck` for narrative and HTML artifact when appropriate
- use `Presentations` for local `.pptx`
- use Google Slides workflow for native Google Slides
- visually verify deck output before delivery
