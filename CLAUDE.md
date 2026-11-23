# Daily Fitted — Project Context

Context for Claude Code and other contributors. Private notes (strategy, plans, machine setup) live in a git-ignored `CLAUDE.local.md`.

Last updated: November 23, 2026.

## 1. The product in one paragraph

This is a social outfit diary. Each day, the user takes one photo of their outfit and ranks it against their past outfits with a few "better or worse?" comparisons, the way Beli ranks restaurants. The AI finds each clothing item in the photo and suggests tags. The user can confirm a brand and item name, like listing on Depop. When the item matches a real product, the app shows the clean product photo and a link. Friends see each other's outfits in a feed, tap an item to see where it is from, and can buy it. The closet fills up on its own from these daily photos, so there is no separate inventory step.

## 2. MVP scope

### In the MVP
1. Daily outfit photo log.
2. Comparison ranking of your own outfits.
3. Friends: invite link, add friend, accept, and a feed of friends' outfits.
4. AI item detection with suggested tags (type, color, possible brand).
5. Brand and type tagging, with product search that shows results as you type.
6. Product matching: a confirmed match gets the product photo and a link.
7. A "Where is this from?" button that asks the owner to tag an item.
8. A closet built automatically from tagged items, with items recognized again in later photos.
9. Private-by-default profiles, plus report, block, and delete account.

### Not in the MVP (later)
- AI outfit generation by mood or inspiration image
- Style match score between friends
- Friend scores for items and brands
- Occasion lists (wedding guest, interview)
- Affiliate commissions (use plain product links for now)
- Yearly stats and a shareable recap
- Borrowing and resale between friends
- Receipt import, and creating items from a text description

## 3. Core user flow

1. The user takes an outfit photo and posts it. **This must take under 10 seconds.**
2. The user answers 1 to 3 "Better or worse than this past outfit?" questions. The outfit is inserted into their ranked list.
3. In the background, AI detects the items and suggests tags.
4. The user confirms, corrects, or ignores each tag. **Tagging is always optional.**
5. When the user types a brand, the app searches for matching products and shows them with photos.
6. A confirmed match gets the product photo and a link. An unmatched item keeps its cropped photo plus its brand and type.
7. Friends see the outfit in their feed. They can tap an item to open its product page or ask "Where is this from?"
8. Tagged items are saved to the closet and auto-tagged in future photos.

## 4. Product rules (do not break these)

- **Never block posting on tagging or detection.** The outfit posts with only the photo.
- **Only swap in a product photo after the user confirms the match.** A wrong match is worse than no match.
- **Never insert sponsored items into a friend's outfit.** The trust comes from "my friend actually wears this."
- **Show a commission disclosure.** Once affiliate links exist, US rules require telling users that links can earn the company money.
- **Users are 18 and older only.**
- **Photos show people's bodies.** Keep them private by default, and make deletion complete, including stored files.
- **Ask permission before using photos for training.** User photos are never used to train or improve models unless the policy says so and users agree.

## 5. Ranking logic (Beli-style)

- Each user has one ordered list of their outfits. This is not final; see the open questions.
- A new outfit is placed into the list with a binary-search style comparison: "Is this better or worse than outfit X?"
- Cap it at about 3 comparisons. If the position is still uncertain, place the outfit at the middle of the remaining range.
- A 1 to 10 score can be computed from list position later. It is not decided whether to show a score.

## 6. Data model

| Table | Key fields |
| --- | --- |
| users | id, username, display_name, avatar_url, is_private (default true), created_at |
| friendships | user_id, friend_id, status (pending / accepted / blocked), created_at |
| outfits | id, user_id, photo_url, caption, worn_on (date), rank_position, created_at |
| items | id, user_id, type, color, brand, name, cropped_photo_url, product_id (nullable), confirmed (bool) |
| outfit_items | outfit_id, item_id, bounding_box (from detection), source (ai / user) |
| products | id, brand, name, image_url, product_url, retailer, source |
| ranking_comparisons | id, user_id, new_outfit_id, compared_outfit_id, result (better / worse), created_at |
| item_requests | id, item_id, requester_id, status (open / answered), created_at |

The SQL migrations in `supabase/migrations/` are the source of truth. The table above is the plan; items, products, ranking comparisons, and item requests are not built yet. The product data source is not decided.

## 7. Tech stack (decided November 23, 2026)

Supabase handles solved problems (sign-in, file storage, hosted Postgres). The app's business logic lives in a Python service.

| Layer | Decision | Why |
| --- | --- | --- |
| Mobile app | Expo (React Native) with TypeScript | One codebase for iPhone and Android |
| Auth, storage, database | Supabase (Postgres, Auth, Storage, Row Level Security) | Don't rebuild solved problems; relational data fits Postgres |
| Backend API + worker | **Python: FastAPI** service (API) plus a background worker | Keeps business logic in one testable service; Python fits the AI work ahead |
| Job queue | A Postgres table using `SELECT ... FOR UPDATE SKIP LOCKED` | No extra infrastructure; safe with many workers |
| Item re-recognition | Image embeddings stored with pgvector | Same database, similarity search |
| Ranking | Fractional rank values (insert between neighbors; only one row changes) | Avoids renumbering the whole list on each insert |
| Item detection | A hosted vision model API (for example Claude), compared against 1 to 2 others | Do not train custom models in the MVP. Stub it until Phase 2 |
| Product search | To be chosen in Phase 2 | Check each source's terms on showing product images |
| Analytics | PostHog | React Native SDK, free tier, feature flags |
| Quality | GitHub Actions CI; pytest, ruff, mypy (Python); ESLint, TypeScript strict (app); tests for RLS rules | Every change is checked automatically |
| Deployment | Docker for the Python service | Same image runs the API and the worker on any container host |

**Who does what:**
- The app talks to Supabase directly for simple reads and writes that RLS protects (own profile, own outfits, uploading photos).
- The app calls the FastAPI service for business logic: ranking comparisons and insertion, the friends feed, friend requests, "Where is this from?" requests, and starting detection jobs. FastAPI verifies the Supabase sign-in token (JWT) on each request.
- The worker takes detection jobs from the queue, so posting never waits on AI.
- Database schema changes live in one place: Supabase SQL migrations. The Python service does not run its own migrations.

**Repo layout (monorepo):**
```
apps/mobile/        Expo app
services/api/       FastAPI service + worker (Python, managed with uv)
supabase/           SQL migrations, RLS policies, seed data
.github/workflows/  CI
```

**Checks to run before calling work done:**
- `npm run test:db` at the repo root (migrations + RLS tests in PGlite)
- `cd services/api && uv run ruff check . && uv run ruff format --check . && uv run mypy src tests && uv run pytest`
- `cd apps/mobile && npm run typecheck && npm run lint`

## 8. Open technical questions

- iPhone only first, or iPhone and Android together?
- Which vision model gives the best detection for the cost?
- Which product data source will be used?
- How will the same item be recognized in a new photo? Candidates are image embeddings and similarity search.
- What does one logged outfit cost in AI and storage?
- How will inappropriate photos be filtered?
