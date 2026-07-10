# Presentation Decks

Use this reference when the user needs slides, a pitch deck, demo deck, investor deck, angel deck, grant deck, accelerator deck, or presentation review.

Always apply `honest-evaluation.md` first. A polished deck cannot rescue a weak story. Say so directly.

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
- Do not recommend applying if the story has no people-want-it evidence.

## Output Standards

When reviewing or drafting:

- pick the deck type
- state the audience
- give a blunt readiness verdict
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
