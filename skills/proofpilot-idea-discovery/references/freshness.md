# Freshness And Availability

Treat the registry as a dated lookup aid. The presence of a public page, accurate documentation, a successful API request, and a working packaged integration are separate observations.

## Read The Fields Together

- `freshness_review.checked_at`: when the entry was reviewed, including attempts that were blocked or inconclusive. This is not a claim that all its information was confirmed.
- `freshness_review.availability`: whether the inspected pages could be accessed. A JavaScript shell, login gate, retrieval limitation, or redirect to unrelated content can leave coverage partial. One failed request does not prove the service is down.
- `freshness_review.content_status`: whether the entry's stated use and access model were confirmed, corrected, partially checked, unverified, or require a source selected during the run.
- `last_verified_at` and `verification.claims`: the date and exact scope of the last successful check. Preserve an older value when a newer attempt did not establish the claim.
- `reference_checks`: direct pages and the claims they support. Publication dates remain separate from retrieval dates.
- `runtime_probes`: individual actual requests, their recorded date or exact time, result, and limits. Do not invent a time when only the date was retained. A successful public GET does not verify authentication, paid access, account writes, wallet actions, or another endpoint.
- Capability `status`: whether ProofPilot ships the integration. A successful external API probe does not upgrade a `connector_spec` to `implemented`.

`available_public` describes a public access route, not guaranteed accessibility in every host. Check the current host and selected page before claiming it was read. `runtime_required` and null source URLs identify inputs that cannot be certified before a specific project, artifact, or target program is selected.

## Recheck What Changes The Decision

Use the current official cohort or local program page for application windows, geography, terms, and requirements. A live marketing page can still advertise an old cohort. Preserve contradictions between official pages; do not invent which deadline applies.

For technical work, inspect current documentation, relevant versions, maintenance or migration notices, and the existing repository. A library can remain downloadable while no longer being the preferred starting point. Documentation describes possible behavior; build and integration verification must test the selected implementation.

Local idea lists, example projects, protocol summaries, and historical winner lists are snapshots. Their local modification time and the date this skill discovers them do not establish freshness. Use them to form a search question, then confirm volatile claims in current primary sources. They are not automatically suitable for current security, pricing, program, or architecture advice.

Internal rubrics, deck lengths, and experiment suggestions are ProofPilot defaults, not published selection criteria or validated universal benchmarks. Adapt them to the actual request. Synthetic examples test the skill; they are not market evidence.

Carry unresolved access or content gaps into the answer and the next check. Use existing authorization for bounded reads; no freshness check authorizes payment, installation, signing, submission, or an unrelated private-data query.
