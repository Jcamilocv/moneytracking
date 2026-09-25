# Ops API local: read safety contract

`npm run ops:read-only` starts an Ops-only HTTP server on `127.0.0.1:4174`.
It requires `OPS_READ_ONLY_MODE=1` and a local `OPS_ADMIN_SECRET` in `.env.local`.
The command loads `.env.local` only; it does not load `.vercel/.env.production.local`.
The local-only read credential can be supplied through `FIREBASE_SERVICE_ACCOUNT_JSON`.
No production credential is loaded by this command.

In this mode, only the eight named `GET /api/ops/*` paths are accepted. Other
methods and paths return `403 OPS_READ_ONLY_MODE` before body parsing, database
access, billing, settlement, Telegram or cron code. All other Vercel API
entrypoints also return that error before their handlers run. Direct Ops action
and audit-write service calls are guarded. The Telegram intake worker and the
historical production repair script refuse to start with this mode enabled.

| Endpoint | Query strategy | Maximum documents returned/read | Other Firestore work | Cache | Pagination | Writes |
| --- | --- | ---: | --- | --- | --- | --- |
| health | One `cronLocks` sample, one cron document, at most six open revenue incidents | 8 | None | No Ops cache | N/A | 0 |
| kpis | Health plus four native count aggregations, at most 21 current-month orders and 21 entitlements; status filtered locally only if the full bounded set was read | 50 | Four aggregations, each limited to 1,000 index entries | 5 minutes; HTTP `refresh` cannot bypass | N/A | 0 |
| incidents | At most 100 operations and 100 revenue incidents | 200 | None | No Ops cache | First bounded page; `total=null` if a source reaches its cap | 0 |
| systems | In-process system registry | 0 | None | N/A | N/A | 0 |
| picks | Single-field kickoff order, at most 200 records; filter locally only if the full ordered set was read | 200 | None | No Ops cache | `limit<=100`, `offset<=100`; capped sets return 503, never partial pages | 0 |
| paper | Latest paper picks | 100 | None | No Ops cache | First bounded page; `totalTrackedPicks=null` at cap | 0 |
| automation | Reuses bounded health calculation | 8 | None | No Ops cache | N/A | 0 |
| audit-logs | Recent audit entries | 200 | None | No Ops cache | `limit<=100`, `offset<=100`; deeper offsets rejected | 0 |

KPI count aggregation returns `null` with source status `capped` if a count
reaches 1,000. Monthly revenue and subscriber count return `null` if their
21-document probe reaches its cap. Picks similarly fail closed at 200 documents.
This prevents a partial sample from being
presented as a company total. These caps are a safety bridge; scalable exact
KPIs will require maintained summary documents or another bounded source.

All Ops reads are request driven. There are no Ops Firestore listeners,
background polling loops or cached full scans. The regression suite uses a
mock database that throws on every unbounded `get()` or `count()`, records
document/index budgets, and rejects writes/listeners. It also tests the
historical HQ failure mode: repeated `?refresh=true` calls cannot trigger new
KPI reads during the cache TTL, and very deep offsets are rejected before
Firestore is called.
