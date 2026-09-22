# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Portal Financiero: a single-owner Next.js 16 portal for researching global companies, CEDEAR access, fundamentals comparison, and reproducible valuations with visible provenance. Spanish-language UI and documentation; English code identifiers and `AGENTS.md`.

The code is public; the data is not. The app is **personal-first**: it serves real data only from a private runtime, and there is no public demo deployment. See [ADR 0004](docs/architecture/adr/0004-personal-first-runtime.md).

The application is early: shell, config health, security headers, the PostgreSQL/Drizzle persistence base, the persisted identity graph with its universe-constitution rule, SEC companyfacts ingestion into point-in-time observations kept to a five-fiscal-year window, issuer succession with a read-time reporting lineage, rule-verified stock splits with a `latest_adjusted` read, venue transfers, delistings and renames reconciled against dated SEC evidence, declared acquisitions and ticker changes, durable ingestion jobs with a per-source lease driving a hand-run universe backfill, per-source daily request budgets with an owner kill switch, a hand-run refresh that probes `submissions` and re-downloads only the filers that filed something relevant, a deterministic FCFF engine with its reference run, a frozen corpus of real SEC extracts as regression oracle, the declared sector classification with its population resolved at `as_of`, and raw daily price series with dated splits and dividends exist. Scheduled refresh, market data, screener, the Argentina dashboard, and AI features are **not** implemented, and no UI surface reads real observations yet; nothing may be presented in the UI as if it were.

`AGENTS.md` holds the full contributor contract and takes precedence over this file where they overlap.

## Commands

```bash
pnpm dev                 # local dev server
pnpm build               # production build (Cache Components enabled)
pnpm lint                # eslint, --max-warnings=0
pnpm typecheck           # tsc --noEmit
pnpm test                # vitest run, src/**/*.test.ts
pnpm test:watch
pnpm test:integration    # tests/integration/**, requires DATABASE_TEST_URL
pnpm test:e2e            # Playwright + axe over one build served as personal and locked
pnpm walkthrough         # serves one build as personal and undeclared for the owner's manual session
pnpm format:check
```

Run a single unit test file or case:

```bash
pnpm vitest run src/modules/configuration/domain/config-health.test.ts
pnpm vitest run -t "partial name of the test"
```

Before handing off a change, run the same sequence CI runs (`.github/workflows/quality.yml`):
`pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, plus
`pnpm test:e2e` for the separate gate job.

The unit suite runs behind a network guard (`tests/setup/no-network.ts`): `fetch`,
`http`, `https`, and raw TCP all throw. A test that needs a provider needs a fixture.

`pnpm test:e2e` builds once and serves that same artifact under two environments —
personal and locked — then runs Playwright and `axe-core` across desktop, mobile,
dark theme, and reduced motion. It needs no PostgreSQL and opens no network. Full
workflow: [docs/runbooks/e2e-accessibility-gate.md](docs/runbooks/e2e-accessibility-gate.md).

`pnpm walkthrough` is not a gate: it prepares the owner's manual session for `F1-08`
by serving one build on `127.0.0.1:3120` with the real `.env.local` and on
`127.0.0.1:3121` with the mode variables blanked. It measures nothing on its own —
the output is a written record. Protocol and template:
[docs/runbooks/owner-walkthrough.md](docs/runbooks/owner-walkthrough.md).

### Database

```bash
pnpm db:generate     # emit versioned SQL from src/server/db/schema.ts; never drizzle-kit push
pnpm db:up           # the project's PostgreSQL 17 on 127.0.0.1:55432 (needs .env.docker.local)
pnpm db:down
pnpm db:migrate      # controlled job; reads DATABASE_DIRECT_URL only
```

One container, two databases on it. `finance_portal_personal` holds the owner's data;
`finance_portal_test` exists only because the integration suite deletes every row of the
tables it touches — `universe-repository.test.ts` empties all nine identity tables
unfiltered — so it cannot share a database with the constituted universe. It does not
need its own server: `scripts/init-test-db.sh` creates it when the volume is first
initialised.

```bash
pnpm universe:constitute            # dry run: fetches, parses and reports, writes nothing
pnpm universe:constitute --apply    # constitutes the S&P 500 into the personal database
```

Constituting is a hand-run job, never a gate: a rebalance **closes memberships**. The
constituents list is pinned to a commit in `live-universe-source.ts`; changing that pin
is a reviewable diff, and the runtime never resolves "latest" on its own.

The same run also records the **sector** (`F7-02`,
[ADR 0025](docs/architecture/adr/0025-declared-sector-classification.md), migration
`0017`). A classification is an assertion with taxonomy, version and validity in
`classification_assignments` — never a column on an entity — because the sector
(`F7-02`), the valuation archetype (`F3-01`) and Damodaran's industry (`F3-05`) are
three different questions about the same company. The first taxonomy is
`sp500-wikipedia-gics-sector`, named that way because it is **not** official GICS but
the column the PDDL package derives from Wikipedia. Its version is the pin and its
`available_at` is the pin's `committedAt`, so an `as_known` before that commit does not
see it. A new pin **supersedes**; it never closes in a date the source never published,
and a company the list stops carrying keeps its sector — absence from an index list is
not evidence of a sector change. The subject is the legal entity, so two share classes
are two securities and one sector. Measured on the personal database: 500 assertions
over the eleven sectors, 0 rejected, 376 kB.

```bash
pnpm prices:ingest --ticker AAPL                   # dry run: downloads and reports, writes nothing
pnpm prices:ingest --ticker AAPL --ticker NVDA --apply
```

Also hand-run (`F7-01`, [ADR 0026](docs/architecture/adr/0026-daily-prices-source.md),
migrations `0018` and `0019`). One request per security brings five years of daily
closes plus dated splits and dividends.

The source is **Yahoo**, and the registry says what that is: there is no
contractual grant of any kind. That forced a vocabulary decision — the rights gate
demands `allowed`, and marking Yahoo that way would have corrupted the value the
whole gate rests on, since `allowed` means "a primary source covers this use". So
rights gained **`owner_accepted`**: nobody grants it, the owner decided to proceed
anyway, dated and with a reason. It enables a run but **never** a public surface,
where `publicDisplay` must still be `allowed`.

The series is stored **raw**, and that is the slice's central decision. The source
publishes it adjusted for later splits and **rewrites it backwards on every one**:
measured on NVDA, the 2024-06-05 close comes back as 122.44 when 1,224.40 is what
traded, because the series is divided by the 10:1 of 2024-06-10. Storing that
would put look-ahead in the database and make a stored row stop matching itself
after the next split. The same response carries the dated splits, so un-adjusting
is deterministic (`raw(t) = close(t) × Π ratio(s) for s later than t`) and the row
becomes immutable, the re-download idempotent, and adjustment a read-time policy
again — exactly as ADR 0012 did for per-share values. Dividends are stored dated
and **unapplied**: the return base is `F7-04`'s open parameter.

The row keeps a close, not an OHLCV, and no source/parser columns — those come
from its run (ADR 0018), and the un-adjust factor rebuilds from `price_events`.
Measured: **158 bytes per row**, so a sector of ~70 securities is ~14 MB and the
whole index would be ~100 MB, above ADR 0016's 60–80 MB estimate. The product only
needs per sector.

```bash
pnpm fundamentals:ingest --ticker AAPL             # dry run: downloads and builds vintages, writes nothing
pnpm fundamentals:ingest --ticker AAPL --apply     # records the run, filings and observations
```

Also hand-run: it needs the constituted universe (the ticker resolves to a CIK
through the persisted graph) and `SEC_USER_AGENT`. Calls go out one at a time at
2 requests/s with a per-run budget. Semantics —acceptance as `available_at`,
vintages, subject resolved by CIK at download time, `year_to_date`— are in
[ADR 0010](docs/architecture/adr/0010-sec-xbrl-ingestion.md).

Only a **history window** is stored (`sec-history-5fy-1.0.0`,
[ADR 0017](docs/architecture/adr/0017-sec-history-window.md)): facts whose period
ends on or after `anchor − 5 years − 14 days`, where the anchor is the filer's own
latest annual period (`fp = FY`), never the clock. That keeps five fiscal years plus
the base close a 5-year comparison needs. The six split-sensitive concepts keep one
more year as split evidence. The cut happens before vintages and before choosing
submissions history files, so it saves requests too. Each run records
`selection_version` (`sec-core-concepts-3.0.0`) and `selection_anchor_on`: together
they say which periods the run went to fetch. The `3.0.0` added the **EPS
numerator** — `NetIncomeLossAvailableToCommonStockholders{Basic,Diluted}` plus the
preferred-dividend bridge — after the `F2-07` reconciliation measured residuals
that could not be explained from what was stored: diluted EPS is not computed on
`NetIncomeLoss`.

```bash
pnpm fundamentals:prune --ticker AAPL                             # dry run: plans and counts, deletes nothing
pnpm fundamentals:prune --ticker AAPL --reason "…" --apply        # deletes and records the prune
```

The window governs new ingestions; what an older selection already published is
removed by this hand-run job (`sec-history-prune-1.0.0`,
[ADR 0019](docs/architecture/adr/0019-observation-history-prune.md), migration
`0013`, [runbook](docs/runbooks/history-prune.md)). It is the exact complement of
the window and shares its arithmetic (`secHistoryCutsFrom`). It opens no network:
the anchor comes from the subject's latest run that recorded one, because the `FY`
focus the anchor needs is not on the observation — a subject without a current
anchor is refused by name (`anchor_unknown`, `selection_superseded`) and the way
out is to ingest it again. Every prune writes an append-only row in
`observation_prunes` in the same transaction as the delete: **for a pruned subject
that row, not the run, explains why a period before its cut is missing.**
`source_documents` and `corporate_actions` are never touched; a split whose
evidence fell outside the window stays registered and the splits run names it
`recorded_split_not_reconfirmed`.

An observation row stores only what it cannot rebuild
([ADR 0018](docs/architecture/adr/0018-lighter-observation-rows.md), migration
`0012`): both hashes are 32-byte `bytea` (the domain still sees hex); source,
dataset and parser come from the row's ingestion run, and publishing a row that
disagrees with its run throws; a null `metric_id` means the reported concept;
`late_ingestion` is derived from `available_at`/`recorded_at` and the domain schema
requires it last exactly when the rule says so. `externalId` is a staging identity
kept in the content hash but not on the published observation;
`secFactExternalId` rebuilds it for SEC rows. Raw SQL that filters observations by
source has to go through `ingestion_runs`.

```bash
pnpm corporate-actions:record           # dry run: verifies declared successions against SEC submissions
pnpm corporate-actions:record --apply   # records predecessor entity, event and relationship
```

Also hand-run. A succession is **declared**, never detected: the owner adds the
predecessor CIK, successor CIK and the `8-K12B`/`8-K12G3` accession to
`declared-successions.ts`, and the job rejects by name whatever the filing index does
not confirm. Predecessor facts keep their own subject; the history is joined at read
time by `reporting-lineage-1.0.0`, and `fundamentals:ingest --ticker` also ingests the
known predecessors' CIKs ([ADR 0011](docs/architecture/adr/0011-issuer-succession-reporting-lineage.md)).

```bash
pnpm corporate-actions:splits --ticker AAPL           # dry run: one companyconcept request, evaluates and plans
pnpm corporate-actions:splits --ticker AAPL --apply   # records confirmed splits and the run
```

Also hand-run, **after** `fundamentals:ingest --apply`: the second piece of evidence is
the filer's already-published facts, and without them the job does not reach the
network. A split is **confirmed by rule**, never declared: the same filing must state
the ratio and re-express at least one EPS and one share count by it; anything with a
single piece of evidence stays a named candidate and adjusts nothing. Splits hang off
the legal entity, and `latest_adjusted` reads restate per-share values into the latest
basis known at the cutoff without rewriting rows; `queryObservations` rejects that
policy, so adjusted reads go through `readLineageObservations`
([ADR 0012](docs/architecture/adr/0012-stock-splits-share-basis.md)). A ratio declared
no later than the filer's first published sensitive vintage is not judged: it is named
`precedes_published_history` (`split-claim-horizon-1.0.0`, ADR 0017), because there is
nothing to compare against and nothing to adjust. `decimal.js` is
imported only by `src/modules/numeric/domain/decimal-policy.ts`, enforced by ESLint.

```bash
pnpm corporate-actions:declare --file /tmp/declaration.json          # validates an explicit owner declaration without writes
pnpm corporate-actions:declare --file /tmp/declaration.json --apply  # records acquisition or ticker change atomically
```

[ADR 0014](docs/architecture/adr/0014-declared-corporate-events.md) and the
[runbook](docs/runbooks/declared-corporate-events.md) define the strict JSON input.
`acquired_by` never joins reporting history. A declared ticker change supersedes the
old assertion and preserves answers before owner verification. A partial SEC table
cannot prove absence. Keep personal declarations outside this public repository.

```bash
pnpm corporate-actions:listings                          # dry run: tickers table + one submissions request per divergent filer
pnpm corporate-actions:listings --cik 0000712515 --apply # also checks a filer explicitly, then closes/opens listings
```

Also hand-run. The live SEC tickers table has no dates, so a divergence from the graph
is only a question; the answer is the filer's index. A **venue transfer** needs the
issuer's `25` and `8-A12B` plus a `CERT` filed by the destination exchange; a
**delisting** needs a `25-NSE` filed by the listing's exchange plus a contemporaneous
8-K item 3.01; the exchange is the accession's submitter CIK (Nasdaq `0001354457`, NYSE
`0000876661`). Both are written at the instant the evidence is complete: the old listing
and ticker close, a transfer opens a new listing ID on the same security, memberships
are untouched. A **rename** uses `formerNames`; one that predates the recorded version
supersedes it instead of closing it in the past. A ticker change on the same venue has
no dated evidence and is rejected by name, never dated with the run
([ADR 0013](docs/architecture/adr/0013-listing-events-dated-evidence.md)). Since
`universe-constitution-1.1.0` a plan-stage rejection holds its issuer's memberships
instead of closing them as index exits.

```bash
pnpm fundamentals:backfill                           # plan over the constituted universe: no network, no writes
pnpm fundamentals:backfill --apply                   # creates (or finds) the job for that plan; --cik narrows it
pnpm fundamentals:backfill --job <id> --apply        # runs it under the sec-edgar lease; --limit caps attempts
pnpm ingestion:jobs [--job <id>]                     # jobs, leases, troubled items and the event log
pnpm ingestion:jobs --job <id> --pause --reason "…" --apply   # also --resume, --cancel, --requeue <ordinal>
pnpm ingestion:jobs --release sec-edgar --reason "…" --apply  # declares the holder dead and recovers its item
```

The universe backfill is no longer a product goal
([ADR 0016](docs/architecture/adr/0016-analysis-scope-sector-matrices.md)): fundamentals
are fetched per valued ticker or per sector, so plans are narrowed with `--cik`. Do
**not** run the whole universe against the personal database without the owner's
go-ahead: even with the window and lighter rows it measured 245 MB on a replica, and the
hosted database of `F6-06` should fit a free tier. A job planned with
`sec-core-concepts-1.0.0` no longer runs: cancel it and plan a new one.

Also hand-run, never scheduled. A job is a fixed plan of CIKs processed **in order,
one at a time**; the cursor is the first non-terminal item. The lease is per
**source**, because what it guards is the source's quota: 5-minute TTL, 60-second
heartbeat, and every worker write is fenced by the lease token, so a zombie's late
checkpoint is refused. Expiry allows a takeover; it does not revoke. An attempt is
counted when it starts: a process that dies leaves its item `running` and the next
holder recovers it, poisoning it at `max_attempts`. A `429`/`403`/`503` or an
unreachable SEC defers the job (`not_before`) without spending the attempt; a wait of
up to 5 minutes is slept through holding the lease, and three signals in a row stop
the run. A
company only starts if the run budget still covers its worst case (66 requests).
Every transition takes `pg_advisory_xact_lock` on the source first and reads the
injected clock, never `now()`; the same contract suite runs on the in-memory double
and on PostgreSQL. Manual commands (`fundamentals:ingest`, `corporate-actions:*`) do
not take the lease: do not run them during a backfill
([ADR 0015](docs/architecture/adr/0015-durable-ingestion-jobs.md),
[runbook](docs/runbooks/ingestion-backfill.md)).

```bash
pnpm ingestion:sources                                               # state, today's usage and control history
pnpm ingestion:sources --source sec-edgar --disable --reason "…" --apply   # also --enable, --limit <n>
```

Every source has a **daily request budget** counted in PostgreSQL per UTC day, plus
an owner **kill switch** ([ADR 0020](docs/architecture/adr/0020-source-daily-budget-kill-switch.md),
migration `0014`, [runbook](docs/runbooks/source-budgets.md)). Both are enforced in
the one egress door before the socket opens, so they bind the backfill and the
hand-run commands alike — a per-run budget bounds a process, and the day is what a
source measures abuse in. Quota is spent on the attempt, and the counter is a single
conditional upsert, so two processes cannot exceed the cap without a lock or a lease.
`SOURCE_DAILY_REQUEST_BUDGETS` declares the caps from the quota matrix (`sec-edgar`
2.000/day): **a source missing from it makes no calls at all**, and a stored control
may only lower a declared cap, never raise it. `getEgressClient` is ESLint-restricted
to `src/server/egress/`; everything else takes `getSourceEgressFetch`. The job asks
one admission before counting an attempt, so `budget_reserve`, `source_disabled` and
`daily_budget_exhausted` stop a run without poisoning healthy subjects.

```bash
pnpm fundamentals:refresh                            # the followed set and its watermarks: no network, no writes
pnpm fundamentals:refresh --cik 320193               # probes that filer's submissions (1 request), writes nothing
pnpm fundamentals:refresh --cik 320193 --apply       # re-downloads companyfacts only if it filed something relevant
pnpm fundamentals:refresh --all --apply              # plans the whole round as a durable job
pnpm fundamentals:refresh --job <id> --apply         # runs it under the sec-edgar lease; --limit caps attempts
```

Also hand-run, never scheduled. What it follows is **the filers that already have
published fundamentals** ([ADR 0021](docs/architecture/adr/0021-refresh-followed-set.md)):
a query, not a list, so the set grows with every `fundamentals:ingest --apply` and
needs no registration. Today that is six filers — five index members plus
ExxonMobil's reporting predecessor.

A round asks `submissions` once per filer and re-downloads companyfacts only for the
ones with a relevant filing newer than their stored watermark
([ADR 0022](docs/architecture/adr/0022-companyfacts-refresh-probe.md), migration
`0015`, [runbook](docs/runbooks/fundamentals-refresh.md)). The watermark is the
`(acceptance, accession)` pair the probe saw, in `ingestion_refresh_state`, and it
advances **even when the new filing publishes no fact** — without it, an 8-K that
carries no selected concept would trigger a download on every round forever. It is
written last, so it can lag a refresh that failed but never lead one that did not
happen. Only `sec-companyfacts-forms-1.0.0` forms wake a download; a Form 4 does
not. Every probe leaves its own `sec.submissions` run, and a round with no news is
recorded `duplicate`. The full round is a durable job of its own kind
(`sec_companyfacts_refresh`, migration `0016`) reusing the ADR 0015 lease and the
ADR 0020 admission, reserving 67 requests per item. Measured on the six: 20 requests
the first round, 6 the second. The refresh never deletes — a new fiscal year moves
the window anchor and `fundamentals:prune` is still what takes the old one out.

```bash
pnpm fixtures:capture                    # the followed set and what it would weigh, writes nothing
pnpm fixtures:capture --cik 320193       # one filer
pnpm fixtures:capture --apply            # downloads and freezes the corpus
```

Also hand-run, and rarely. The **frozen corpus** is the second regression oracle
next to the synthetic filer: the filer proves the parser does what we think, the
corpus proves the cable is what we think, with numbers that reconcile against the
filing ([ADR 0023](docs/architecture/adr/0023-frozen-sec-extracts-rights.md),
[runbook](docs/runbooks/golden-corpus.md)). Two requests per filer; the corpus
itself never goes back to the network and no test downloads anything.

Freezing real SEC extracts in a public repository is a rights decision, not a
technical one: sec.gov content is public information the SEC lets anyone copy and
redistribute with citation, so `sec-edgar` now declares `rawStorage`,
`publicDisplay` and `export` as `allowed` — `aiTransfer` stays `unknown` because
the receiver decides that one, and the row stays `approved_personal`, so a public
surface still needs `approved_public_demo`. A corpus is not a recording: it is a
chosen extract, reduced by a declared reducer version, carrying a manifest, from a
source whose rights are `allowed`. All four hold together or it stays out.

The reducer (`sec-corpus-reducer-1.0.0`) is deliberately **coarser** than what the
corpus tests — eight fiscal years against the window's six, plus a declared sample
of unselected concepts and the first concept of every unknown taxonomy — because a
file trimmed by the selection would make the selection's own test a tautology.
Rewriting the JSON preserves every number's source text: a `val` that round-trips
through a `double` is an invented value. Files are pinned by `sha256` in
`manifest.json`, Prettier ignores the directory, and a test recomputes the hashes.

```bash
pnpm gate:point-in-time                  # audits every published chain; no network, no writes
pnpm gate:point-in-time --json           # the same report as evidence
```

The **gate of Phase 2**, turned into a command (`F2-07`,
[runbook](docs/runbooks/point-in-time-audit.md)). Its claims used to be one-off
manual checks written in prose — Apple before and after its 10-K/A, ExxonMobil
before and after the `8-K12B`; the verifier evaluates them over **every** chain
the database holds and names the one that stops holding. It is read-only.

Five claims: a row that cites a document reaches it with the same availability;
availability is the filing's acceptance and never the download instant; the
revision chain is dense, ordered, linked and has exactly one current revision; an
`as_known` one instant before a revision's acceptance returns the previous one and
at the acceptance returns that one; and a new revision changes something. The
fourth runs **through `queryObservations`**, the same domain the application
reads — a verifier with its own copy of the selection would prove the copy. A
claim that was never evaluated is `not_exercised`, never a pass, and the command
exits non-zero: a database with no restated chain proves nothing about
look-ahead.

```bash
pnpm gate:reconcile                      # the gate sample's reconciliation sheet; no network, no writes
pnpm gate:reconcile --batch 2 --json
```

The second increment of `F2-07` ([runbook](docs/runbooks/gate-reconciliation.md)).
The archetype of a company is **declared**, like a succession: nothing in the
database can say what archetype a company is — there is no sector, industry or SIC
column, and the versioned classification is `F7-02`, which the roadmap runs after
this phase. `declared-gate-sample.ts` holds thirty companies with the reason for
each, and `assertGateSample` refuses a sample that repeats a company, leaves an
archetype unrepresented, or whose first batch does not reach all ten.

Seven anchors per company, read through `readLineageObservations` at the latest
published fiscal year end — balance-sheet anchors included, so one sheet
reconciles against one filing. Each anchor declares **alternative concepts in
order** and the output names the one that supplied the number: archetypes do not
report the same concepts, and a declared alternative is the opposite of a silent
substitution. An anchor with none of its alternatives is `no reportada`, never a
zero.

Integration tests need a dedicated disposable database; `tests/integration/setup.ts` throws without `DATABASE_TEST_URL`. Full workflow, rollback procedure, and safe-failure cases: [docs/runbooks/database-migrations.md](docs/runbooks/database-migrations.md).

Node `>=22.11.0 <27`, pnpm `10.33.2` via corepack. Arch Linux dev host — use POSIX shell syntax for env-var examples in docs, matching the `ubuntu-latest` runners CI validates on.

## Architecture

Modular monolith. Dependencies point inward; the domain never imports React, Next.js, Drizzle, or provider SDKs.

```
src/app/                          routes, layout, _components (shell, sidebar)
src/components/ui/                shadcn/Base UI primitives, added only when used
src/modules/<domain>/
  domain/                         pure, testable, framework-free (Zod schemas + logic)
  application/                    ports, repository interfaces, mode selection
  infrastructure/                 fixtures and in-memory test doubles
src/server/
  config/                         server-only environment reads
  db/                             Drizzle schema, pooled runtime client, PG repositories
  egress/                         the only way out to the network (allowlist + SSRF guard)
  persistence/                    composition root per effective mode
  security/                       security headers used by next.config.ts
drizzle/                          versioned SQL + rollback/ pairs
tests/integration/                PostgreSQL-backed tests
```

Server Components call application services directly — no internal HTTP fetch. Pages read persisted snapshots; they never call providers during render. Everything touching secrets, the DB, providers, or AI imports `"server-only"` (aliased to a stub in both vitest configs).

### Modes are a security boundary, not a feature flag

`getConfigHealth()` in [src/modules/configuration/domain/config-health.ts](src/modules/configuration/domain/config-health.ts) resolves the **effective** mode from `APP_MODE` × `APP_RUNTIME_ACCESS` × `DATABASE_URL` × Vercel env. Everything downstream keys off that resolved mode, not off the raw env var:

- `personal` → requires `local` (outside Vercel) or `protected` (Vercel Preview) access **plus** a pooled `DATABASE_URL`. The only mode that serves data.
- `locked` → everything else. Serves no data, opens no DB connection, calls no provider. It is a refusal, not a demo: there is no fallback dataset.

Surfaces gate on `servesRealData(health)` and render `RuntimeLockedNotice` otherwise; they never compare the mode by hand. Composition roots build dependencies through `selectPersonalDependency()`, which throws `RuntimeLockedError` rather than substituting a fixture. Cache identities include the mode. Setting a key in `.env.local` does not enable an unimplemented integration.

The mode is resolved **during the request**, never at build time. Surfaces read it only through `getRequestConfigHealth()`, which awaits `connection()` first, and each such route declares `export const instant = false` ([ADR 0005](docs/architecture/adr/0005-request-time-runtime-boundary.md)). Without that, Cache Components prerenders the route and bakes the building machine's mode into the HTML, so the artifact would serve data regardless of the runtime that serves it. Do not add a synchronous way to read the mode.

The in-memory repositories (`in-memory-*`) are **test doubles**, not a runtime mode. No composition root builds them.

`DATABASE_URL` is pooled runtime; `DATABASE_DIRECT_URL` is migration-job only and is never read at runtime.

## Non-negotiable domain rules

Read [docs/data/identity-model.md](docs/data/identity-model.md) and [docs/data/point-in-time-contract.md](docs/data/point-in-time-contract.md) before touching identity, mappings, observations, corporate actions, or historical queries.

- Keep `legal_entity → security → listing → listing_symbol` separate. Depositary programs link a depositary security to an underlying via versioned ratios; they never merge the two instruments. Tickers are time-bound lookup values, never stable foreign keys.
- Every historical read declares effective time, knowledge cutoff, revision policy, and corporate-action adjustment basis. Preserve `available_at`, `recorded_at`, vintages, restatements, and lineage. A later filing must never leak into an earlier `as_known` result — see the temporal columns and check constraints on `dataset_snapshots` in [src/server/db/schema.ts](src/server/db/schema.ts).
- A classification —sector, archetype, industry— is an assertion with taxonomy, version and validity in `classification_assignments`, never a column on an entity, and a taxonomy is named for what it is rather than for what it reproduces. A subject has at most one open assertion per taxonomy; a subject with none is `null` with a reason, never a default bucket.
- Missing values stay `null`. Never coerce a missing financial value to zero.
- Financial formulas are pure, deterministic, versioned, and require unit tests plus edge cases for null, zero, negative, currency mismatch, and non-finite results.
- Zod schemas are the runtime source of truth at boundaries; DB check constraints mirror the schema invariants (e.g. manifest present iff `manifest_status = 'stored'`).

Before adding a Route Handler, Server Action, provider, export, job, or AI capability, read [docs/security/threat-model.md](docs/security/threat-model.md) and close the `TM-*` controls assigned to that surface.

Network egress has exactly one door: `getEgressClient()` in [src/server/egress/](src/server/egress/). It takes a `sourceId` plus a URL that must match that source's allowlisted host **and** path prefix — there is no function that accepts a bare URL, and adding one reopens `TM-08` ([ADR 0009](docs/architecture/adr/0009-egress-boundary.md)). Being on the egress allowlist grants reachability, never the right to ingest: the source registry's rights gate is a separate control. Do not import `node:https`, `fetch`, or an HTTP SDK anywhere else.

That door is metered. `getEgressClient` is ESLint-restricted to `src/server/egress/`; every other caller takes `getSourceEgressFetch`, which pairs the per-run pacing with the daily budget and the kill switch ([ADR 0020](docs/architecture/adr/0020-source-daily-budget-kill-switch.md)). Three controls, none implying another: the allowlist answers "where may a socket open?", the rights gate "do we have a right to this data?", and the budget "is there quota left today?". A source missing from `SOURCE_DAILY_REQUEST_BUDGETS` makes no calls at all.

Scope guardrails: no application auth, accounts, roles, multi-tenancy, or BYOK. Real providers run only in personal mode. Never put secrets in `NEXT_PUBLIC_*`, and never commit captured payloads or credentials to this public repository. The one exception is a **frozen corpus** under [ADR 0023](docs/architecture/adr/0023-frozen-sec-extracts-rights.md): a chosen, reduced, manifested extract of a source whose rights say `allowed` — today only `sec-edgar`. All four properties must hold; a personal run's payload has none of them and stays out.

## Working rhythm

Work one authorized slice at a time. [docs/finance-portal-masterplan/06_PHASED_ROADMAP.md](docs/finance-portal-masterplan/06_PHASED_ROADMAP.md) authorizes the phase; [docs/backlog/README.md](docs/backlog/README.md) decides which issue is next, with acceptance criteria and `TM-*`/`UI-*` traceability. Only one issue may be `in_progress`. An issue is `done` only when its acceptance criteria and evidence are recorded.

Closing a slice means updating the backlog tracker **and** appending a row to the roadmap session log (date, phase/slice, result, status, evidence, next slice/blocker) in the same delivery. New structural dependencies or providers need an ADR in [docs/architecture/adr/](docs/architecture/adr/) first.

Git follows one branch per major section: a backlog issue or a cross-cutting docs or tooling change, named `<type>/<issue>-<summary>` (`feat/f2-05-history-window`). `main` changes only through a pull request. The PR merges with a merge commit once CI is green, and the branch is then deleted on the remote and locally. Details in `AGENTS.md` → Commits & Pull Requests.

## UI work

Any task that creates or materially changes a page, component, dashboard, chart, table, empty state, theme, or responsive layout must invoke the `impeccable` skill before editing UI code, plus `financial-visualization-review` for charts, metric tables, screeners, and sensitivities.

Both skills are vendored once under `.agents/skills/` (Codex convention) and registered with Claude Code through pointer skills in [.claude/skills/](.claude/skills/). Invoke them by name; the pointer forwards to the vendored copy. **Resolve `<skill-base-dir>` and every relative reference path against `.agents/skills/<skill>/`** — `${CLAUDE_SKILL_DIR}` expands to the pointer directory and will not find the skill's references or scripts.

Only the read-only `context.mjs` and `detect.mjs` scripts are approved. Impeccable hooks, live editing, concept network calls, image generation, and self-update are disabled in [.impeccable/config.json](.impeccable/config.json) and require explicit user request plus review before running. Updating a vendored skill means updating its pin, its pointer, and its row in [docs/agent/skills-inventory.md](docs/agent/skills-inventory.md) in the same change.

Approved visual decisions live in [DESIGN.md](DESIGN.md) (tokens, typography) with per-surface briefs in `.impeccable/surfaces/`. shadcn is configured for Base UI + CSS variables ([components.json](components.json)); Recharts is the chart engine and ECharts is a measured escape hatch — do not add a second chart library without evidence. Read [docs/design/interface-foundations.md](docs/design/interface-foundations.md) before expanding the visual system; the home page is evidence, not a universal layout.

Avoid generic AI-interface defaults (decorative gradients, gratuitous glass blur, interchangeable rounded cards, icon tiles above every heading, timid typography). Favor financial-product hierarchy, legible numeric density, and visible provenance.

## Conventions

Two-space indent, `camelCase` values, `PascalCase` types/components, kebab-case files and module directories. Tests are colocated as `*.test.ts` next to the unit under test in `src/`; integration tests live in `tests/integration/`. Import via the `@/*` alias. Commits use short imperative subjects with a scope, e.g. `docs(architecture): clarify provider boundary`.
