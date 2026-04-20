# BecauseILiked

An AI-powered recommendation app where users describe something they loved **and why**, and the system responds with recommendations along with specific explanations of how each match fits the stated reasons.

Most recommenders treat users as passive signals — what you watched, what you rated, what you abandoned. BecauseILiked treats users as _authors of their own taste_: the "why" is the input, and the explanations for each recommendation are the output.

Live at [because-i-liked.vercel.app](https://because-i-liked.vercel.app). Might move to a different domain in upcoming phases.

---

## Status

**Phase 1 complete.** The foundation is shipped: auth, a seeded film catalog, a full add-love loop, and a placeholder recommender with a stable interface ready for AI swap-in. No LLM layer yet — by design.

See [Roadmap](#roadmap) for what's next.

## Why this exists

Two stated goals, in priority order:

1. **Learn the modern AI application stack deeply** — embeddings, vector search, RAG, prompt engineering, agents — by building something that genuinely needs each of them, rather than absorbing concepts in a vacuum.
2. **Ship a real product** that's useful enough that strangers might actually come back to it.

The project is structured so that every phase delivers a running, deployed app, and every new concept is introduced when it solves a problem the product actually has.

## Architecture overview

```
┌──────────────────────────────────────────────────────────────┐
│                         Browser                              │
│        Next.js Server Components  +  Client Components       │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│            Next.js App Router (hosted on Vercel)             │
│   Server Actions · API-less data access · SSR cookies        │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                          Supabase                            │
│  Postgres · pgvector (ready) · Auth · Row Level Security     │
└──────────────────────────────────────────────────────────────┘
                           │
                   ┌───────┴────────┐
                   ▼                ▼
               External           Future:
               catalog APIs       OpenAI embeddings
               (TMDB, IGDB,       Anthropic / OpenAI LLMs
               Books)             (Phase 3+)
```

A few deliberate choices worth flagging:

**No separate backend server.** Next.js Server Components and Server Actions handle all data access directly from page handlers. Supabase's PostgREST + RLS gives us a secure data layer without a middle-tier API. This removes an entire service from the architecture.

**RLS as a primary security boundary, not a fallback.** Every table has explicit policies enforcing per-user access at the database layer. The app-layer checks are defense in depth, not the first line. This means a bug in the application code cannot leak another user's data — the database refuses the query.

**A stable recommender interface from day one.** The Phase 1 implementation is a random-same-genre picker. Phases 3 and 4 will swap in embedding similarity and then LLM-based reranking — but the function signature consumed by the UI stays the same. UI work is never blocked on AI work.

**Cost discipline built into the plan, not retrofitted.** Embedding versioning, recommendation caching by `(user_love_id, candidate_set_hash)`, per-user rate limits, and hard spend caps on the LLM providers are all specified before the first LLM call gets made.

## Tech stack

| Layer         | Choice                                                      | Notes                                                                 |
| ------------- | ----------------------------------------------------------- | --------------------------------------------------------------------- |
| Framework     | Next.js 16 (App Router, Turbopack)                          | Server Components as the default; client components only when needed. |
| Language      | TypeScript                                                  | Strict mode.                                                          |
| Styling       | Tailwind CSS                                                | Utility-first; no component library yet (premature).                  |
| Database      | Supabase (Postgres)                                         | Hosted in `ap-south-1` (Mumbai) for latency.                          |
| Auth          | Supabase Auth (email/password + Google)                     | SSR-friendly via `@supabase/ssr`.                                     |
| Vector search | pgvector (Postgres extension)                               | Enabled at project level; indexed usage begins Phase 3.               |
| Hosting       | Vercel                                                      | CI/CD via `git push`; environment variables scoped per env.           |
| Catalog data  | TMDB (films, TV), IGDB (games), Open Library / Google Books | Phase 1 uses films only.                                              |
| Embeddings    | OpenAI `text-embedding-3-small` (1536-dim)                  | Introduced Phase 3.                                                   |
| LLMs          | Claude Haiku 4.5 / GPT-4o-mini (cost-tier)                  | Introduced Phase 4. Heavier models only when quality demands.         |

## Data model

The schema is designed for a **single unified item table across all media**, so that cross-medium features (an opt-in power feature later) don't require a structural migration. Phase 1 populates `film` only.

```sql
-- Enum for media types; all four live in one table.
create type medium_type as enum ('film', 'tv', 'book', 'game');

-- Unified catalog.
items (
  id               uuid primary key,
  medium           medium_type not null,
  title            text not null,
  year             int,
  creators         jsonb,            -- [{role: 'director', name: '...'}, ...]
  synopsis         text,             -- from source API
  themes           text[],           -- genres in P1; enriched in P3
  tone             text[],           -- keywords in P1; enriched in P3
  external_ids     jsonb,            -- {tmdb_id: 123, igdb_id: 456, ...}
  poster_url       text,
  tmdb_id          text generated always as (external_ids->>'tmdb_id') stored,
  created_at       timestamptz
)

-- Minimal profile row; created automatically on user signup via trigger.
profiles (
  id               uuid primary key references auth.users(id),
  display_name     text,
  avatar_url       text,
  ...
)

-- The heart of the app: what users loved and why.
user_loves (
  id               uuid primary key,
  user_id          uuid references auth.users(id) on delete cascade,
  item_id          uuid references items(id) on delete set null,  -- nullable on purpose
  free_text        text not null,          -- the "why I loved it" reasoning
  freeform_title   text,                   -- for entries that don't resolve to a catalog item
  created_at       timestamptz
)
```

**Columns deferred to later phases** (listed here so the schema evolution is not a surprise):

- `items.enriched_description` — LLM-generated rich text, one-time batch per item. Added Phase 3.
- `item_embeddings(item_id, embedding vector(1536), embedding_version)` — Added Phase 3. Versioned so prompt-tweak re-embeddings don't invalidate live queries.
- `user_loves.love_embedding vector(1536)` — embeds the user's `free_text`. Added Phase 3.
- `recommendations(user_love_id, candidate_set_hash, payload jsonb, ...)` — Result cache. Added Phase 4.

### Constraints worth naming

- `items.tmdb_id` is a **stored generated column** (not an expression index) to make `ON CONFLICT` targets clean for upserts. Expression indexes can be subtle with Supabase's upsert layer; a real column sidesteps the ambiguity.
- `user_loves(user_id, item_id)` has a **partial unique index** (where `item_id is not null`). A user can only love a given catalog item once, but can have multiple freeform entries (item_id = null) describing different things.

## Security

Row Level Security is enabled on every user-facing table. Policies, in summary:

- `profiles` — readable by everyone, writable only by the row's owner.
- `items` — readable by everyone; no writes via the public API. Batch ingestion uses the service role key in a script, bypassing RLS intentionally and only at build time.
- `user_loves` — all operations restricted to `auth.uid() = user_id`. A user cannot see, insert, update, or delete another user's rows even with a crafted client.

The service role key never leaves server-side scripts; it is not in the Next.js client bundle and not in any route handler that is reachable from a user-controlled input path.

Auth checks in mutations use `supabase.auth.getUser()` (which verifies the JWT against the auth server) rather than `getSession()` (which trusts the cookie). The small extra round-trip is worth the integrity guarantee.

## Directory layout

```
.
├── scripts/                    # Operational scripts (not part of the deployed app)
│   ├── seed-tmdb.ts           # Idempotent TMDB catalog ingestion
│   └── lib/
│       ├── tmdb.ts            # TMDB API wrapper with retry/backoff
│       └── transform.ts       # TMDB → unified item schema
├── src/
│   ├── app/
│   │   ├── (auth)/            # Route group: sign-up, sign-in, shared actions
│   │   ├── auth/callback/     # OAuth + email confirmation handler
│   │   ├── browse/            # Public catalog browsing
│   │   │   └── [id]/          # Movie detail + Add Love form
│   │   ├── my/loves/          # Signed-in user's Loves list
│   │   ├── recommendations/[loveId]/   # Placeholder recs page (P4 target)
│   │   ├── dashboard/         # Signed-in landing
│   │   └── page.tsx           # Marketing home
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts      # Browser client (anon key)
│   │   │   ├── server.ts      # Server-component / route-handler client
│   │   │   └── admin.ts       # Service-role client (scripts only)
│   │   └── recommender/
│   │       └── index.ts       # Stable interface; placeholder impl in P1
│   └── middleware.ts          # Session refresh on every request
└── next.config.ts             # Includes TMDB image domain whitelist
```

## Local setup

### Prerequisites

- Node.js 20+
- A Supabase project (free tier is enough)
- A TMDB API key — the "Read Access Token" (v4 auth) from [themoviedb.org](https://www.themoviedb.org/)

### First-time setup

```bash
git clone <repo>
cd becauseiliked
npm install
cp .env.example .env.local   # then fill in the values below
```

Required environment variables:

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key>
SUPABASE_SERVICE_ROLE_KEY=<secret / service role key>
NEXT_PUBLIC_SITE_URL=http://localhost:3000
TMDB_ACCESS_TOKEN=<your TMDB v4 read access token>
```

Apply the schema: the DDL lives in [`/docs/schema.sql`](#) (to be extracted from session notes; currently applied directly via the Supabase SQL Editor).

### Running

```bash
npm run dev                   # start dev server at http://localhost:3000
npm run seed:tmdb             # one-time: ingest ~500 popular films into `items`
npm run build                 # production build (Turbopack)
npm run lint
```

### Deploying

Vercel autodeploys from `main`. Environment variables must be set in the Vercel project settings for both Production and Preview. After adding new env vars, redeploy the most recent build so they take effect.

## The seeder, and why it's worth reading

`scripts/seed-tmdb.ts` is more substantial than it needs to be for 500 rows, because it's also the template for Phase 2's larger ingestions (TV, games, books, each in the 2–5k range). A few patterns worth naming:

- **IPv4-first DNS resolution.** Some ISPs route IPv6 poorly for specific domains; explicit `setDefaultResultOrder('ipv4first')` avoids the class of "works in curl, fails in Node" issues.
- **Exponential-backoff retry** around every TMDB call. Transient `ECONNRESET` / `ETIMEDOUT` on mobile or metered networks is common enough that every external call is wrapped.
- **Interleaved fetch-and-upsert.** Rather than fetching all 500 details and then batch-inserting at the end, details are fetched in a loop and flushed to Supabase every 50 rows. If the script dies midway, whatever batches already succeeded are already in the database; a rerun resumes naturally because upsert is idempotent.
- **Deduplication at both collection and upsert time.** TMDB's `popular` endpoint occasionally returns the same movie across adjacent pages as popularity rankings shift. A `Set`-based dedup at ID collection plus a defensive per-batch dedup before upsert prevents `ON CONFLICT DO UPDATE cannot affect row a second time` errors.

These aren't cleverness for its own sake — each one exists because it was needed during the Phase 1 build.

## Testing the full user loop (manual smoke test)

After a fresh deploy or significant change:

1. Browse the catalog while signed out → confirm the grid renders with posters, search works, pagination works.
2. Click a film → detail page loads. The Add Love affordance should show "Sign in to add."
3. Sign in with email (or Google) → confirm the `next` query parameter returns you to the film detail page, not the dashboard.
4. Write a Love of ≥ 30 characters → confirm the button enables, submit once, confirm you land on `/my/loves?added=1` with the green banner.
5. Click the same film again → the form is replaced by the "You've already added this" card (the unique constraint is enforced).
6. Try to double-click the save button on a fresh film → confirm only one entry is created (useTransition guards against duplicate submission).
7. On `/my/loves`, click "Find similar →" → land on `/recommendations/:loveId` with 5 placeholder recommendations.
8. Click a recommendation → arrive on that film's detail page. The loop closes.

## Roadmap

### Phase 1 — Foundation ✅ shipped

Auth, schema, RLS, ~500-film seed, browse, add-love, my-loves, placeholder recommendations. No AI.

### Phase 2 — Multi-medium catalog

Expand `items` to include TV, games, and books. Targets roughly:

- 500 popular TV shows via TMDB
- 2–5k games via IGDB (Twitch OAuth required)
- 2–5k books via Google Books or Open Library

UI changes: medium filter on `/browse`, medium-aware mentions, same-medium default for recommendations (cross-medium remains opt-in).

### Phase 3 — Embeddings and semantic search

- LLM-enriched descriptions for every item (one-time batch, cost-capped, versioned).
- `text-embedding-3-small` over each enriched description; `pgvector` cosine index on the embedding column.
- A semantic search endpoint that replaces the placeholder recommender's retrieval step. This is the first phase where AI is actually in the hot path.

### Phase 4 — RAG recommendations + freeform input

- Retrieve top-30 candidates via embeddings; rerank and explain top-5 with an LLM.
- Streaming responses in the UI so the first explanation appears quickly.
- **New primary input: a freeform prompt box with `@mentions`.** Typing `@` opens a fuzzy-search popover against items (resolved to `item_id` locally, no LLM). Plain text goes through LLM entity resolution; ambiguous references trigger a conversational followup ("Did you mean X, Y, or Z?"). A confirmation UI shows extracted items + reasons before saving: _"We understood: you loved X because Y. [Looks good] [Edit]"_. This becomes the landing-page CTA; the catalog-first flow stays as a secondary path.

### Phase 5 — Taste profiles

Persistent profiles built from a user's accumulated Loves. Multiple loves combined into a single query either by averaging embeddings or by retrieving against each. Recommendations available without requiring fresh input.

### Phase 6 — Polish and launch

Shareable recommendation cards, public taste-profile pages (opt-in), onboarding, mobile polish, Reddit launch (r/ifyoulikeblank and friends).

### Phase 7+ — Agents

An agent mode capable of multi-step reasoning: looking up a director's filmography, pulling Letterboxd-style reviews, cross-referencing user context, and synthesizing nuanced recommendations that the simpler RAG pipeline cannot produce.

## Cost discipline

A rough ceiling has been set for the whole Phase 1–6 build:

- **One-time item enrichment + embeddings**, across ~15k items: under $20 with the cheap model tier, under $100 with a premium tier. Target is the cheap tier unless evaluations show meaningful quality loss.
- **Development + testing LLM usage** through Phase 4: under $50.
- **Hard monthly spend caps** set on both provider dashboards during development to prevent runaway bills from loops or bugs.
- **Caching** of recommendation responses keyed by `(user_love_id, candidate_set_hash)` so repeat requests are free.
- **Embedding versioning** — items carry an `embedding_version` column so prompt tweaks don't require re-embedding the entire catalog; only affected subsets are re-run.
- **Rate limits** per authenticated user via Upstash before public launch.

At small-launch scale (100 active users doing 5 recommendations/month), ongoing cost is estimated at under $5/month. At 2k active users, ~$130/month with room to reduce via aggressive caching. Monetization is deferred until users already find the product valuable; see [Monetization](#monetization).

## Monetization

Deferred until after Phase 6 and intentional.

- **Possible**: affiliations and donations.
- **Never**: display advertising, selling taste data.

## Non-goals

- **A new vector database.** Postgres + pgvector is sufficient for the foreseeable future; a specialized vector DB adds operational surface with no meaningful win at this scale.
- **Multi-tenant hosting, SSO, audit logs, compliance posture.** This is a consumer app.
- **Real-time collaboration or live features.** Supabase supports them; we simply don't need them for the core loop.
- **A mobile app.** The web app is mobile-responsive. A native app is a Phase 10+ conversation, if ever.

## Contributing

Not currently soliciting contributions. If the project reaches a state where it could benefit from them, a `CONTRIBUTING.md` and issue templates will appear here.

## License

Not yet decided. Default "all rights reserved" until an explicit license is added.

---

_Authored during the Phase 1 build. Expect this document to be rewritten substantially at the Phase 4 milestone, when the AI layer is in place and the architecture is no longer theoretical._
