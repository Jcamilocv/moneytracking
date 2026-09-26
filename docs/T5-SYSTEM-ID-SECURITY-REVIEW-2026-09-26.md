# T-5 system ID review · 26 September 2026

Review target: `fix/t5-system-id-markdown-parser` at `d3593dc`. This note covers local code and offline tests only. No VPS service, Firestore, Telegram, or production state was changed.

## Findings and corrections

1. The original normalizer stripped incomplete Markdown and invisible characters from the middle of IDs. `getSystemDefinition()` called it for every caller and a plain object lookup accepted inherited names such as `constructor`. The review limits formatting cleanup to complete paired wrappers at the Telegram parsing boundary. The registry itself accepts only its own exact keys. All nine legitimate IDs retain their internal spelling and case.
2. `WOULD_PUBLISH` previously accepted a known system even when league, selection, odds or kickoff were wrong or missing. The router now rejects those candidates before deduplication. The source league aliases already represented in worker fixtures (`FRA-L1`, `FRA-L2`, `GER-BL`) remain recognized against registry league names. Messages without an explicit approved league are rejected, including the classic-format `Fútbol` fallback.
3. The worker forwarded `routed.candidate.rawSelection`, a field absent from the canonical candidate. Production intake would pass `undefined` as `bet.selection` and fail official validation after `WOULD_PUBLISH`. Both production and paper branches now forward the canonical selection. A local injected sink exercises the production branch, and `normalizeOfficialPickInput()` accepts it with the same expected `op_` identity. The real sink was never invoked during review.
4. A delayed live message could reach production intake after kickoff. The worker now checks the current processing time immediately before the intake boundary and skips expired candidates. Startup replay remains passive.
5. Invalid candidates are visible in worker logs and replay quarantine rather than disappearing silently.

## Evidence and limits

- 106 targeted T-5/registry/worker/replay/sports-provider tests and 106 official-pick tests passed. Build passed. ESLint passed for every file modified during review. Repository-wide lint still fails on 568 pre-existing issues, mostly outside this diff.
- The 28499 fixture includes the reported bold system ID, match, time and market, and reaches `WOULD_PUBLISH` through the real parser/router code. It is a **reconstruction**, not a byte-for-byte replay of a captured MTProto message: the original raw payload was not available locally. Its odds, probability, formatting and entire text have not been independently authenticated.
- `WOULD_PUBLISH` is a routing decision. The worker test uses the same `TheSportsDbProvider` class as the daemon with an offline HTTP response, then executes the production branch up to an injected intake sink and the real official-input validator. The response is a test fixture, not an independently verified sports result. Actual Firestore transaction, Telegram outbound, preflight confirmation and VPS service wiring were not exercised, as instructed.
- The new league gate will reject any genuine FutbolBrain message that omits a league code. Verify the original 28499 text and sender format before owner approval.

## Owner-controlled deployment and rollback plan

1. Before any deployment, obtain the original 28499 raw text from an approved read-only source and replay it offline against the pinned review commit. Record the exact currently running VPS commit, service unit and deployment path without exposing secrets.
2. Under separate owner authorization, stage the pinned commit in a separate release directory; keep the previous release intact. Run the local checks there without production credentials.
3. Switch only to the existing worker's `DRY_RUN` mode and validate startup, connection, source chat, replay and logs. The replay must not publish historical picks. Production mode needs a separate go/no-go decision after these observations.
4. If a permitted production rollout later fails, restore the recorded prior release and service configuration, restart that service once, and verify its health and logs. Code rollback cannot undo any pick already published; the initial dry-run gate is essential.

No deployment or push was performed by this review. A push to this repository may trigger an automatic preview deployment, so remote publication is deliberately outside the review scope until that automation is confirmed or approved.
