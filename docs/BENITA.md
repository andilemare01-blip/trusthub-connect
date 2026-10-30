# Benita: the knowledge engine behind TrustHub Connect

Benita collects public information about Zimbabwean businesses, things for sale, jobs and everyday facts, cleans it, and serves it to Wisdom through one search. Every result carries an honest trust label, so the bot can always answer without overclaiming.

## How the pieces fit

| Piece | Where | What it does |
| --- | --- | --- |
| `benita-ingest` | `supabase/functions/benita-ingest/` (Supabase edge function) | Collects configured websites, ZERA fuel prices and the RBZ exchange rate |
| `benita_osm_request()` / `benita_osm_process()` | Postgres functions | OpenStreetMap: the database fetches each 1-degree cell from Overpass through pg_net, then parses it, names each place's town and suburb from the nearest OSM places, and upserts it |
| `benita_search()` | Postgres function | One ranked search over `knowledge_records`, directory-only `businesses` and `trusthub_connect_listings`, de-duplicated, with a trust tier per row |
| `benita_current_facts()` | Postgres function | Latest value of every fact (`fuel.diesel`, `fx.usd_zwg`, ...) |
| `benita_stats()` | Postgres function | Counts and latest jobs for the admin overview |
| `benita_sync_businesses()` | Postgres function | Mirrors new records into `businesses`, which the review, card and name-lookup journeys read |
| `lib/benita/` | Next.js app | Types, the search and facts client, and WhatsApp formatting |

The app reaches Benita through `ConnectStore.benitaSearch()` and `ConnectStore.currentFacts()`. Today these are used in three places:

1. **Empty directory.** When a "find a plumber in Gweru" search finds nothing in the TrustHub directory, the coordinator answers from Benita instead of a dead end (`coordinator.ts`, `benitaForRequest`).
2. **Unclear messages.** Before replying "I didn't understand", the coordinator tries a confident Benita match (`benitaFreeText`, at least two results scoring 0.95 or more).
3. **Facts and deep questions.** "Fuel price today" and "ZiG rate" are answered from `benita_facts`, and Ask Wisdom receives Benita results and facts as data.

Web listings collected by Benita also appear in the existing *Buy or sell*, *Jobs* and *Houses* searches, labelled with the site they came from.

## Trust tiers

| Tier | Label shown | Meaning |
| --- | --- | --- |
| verified | TrustHub verified | Owner claimed it and TrustHub checked it |
| claimed | Owner-managed, not yet verified | Owner proved control of the listed number |
| listed | Listed, not verified | Open dataset (OpenStreetMap) or a TrustHub directory row |
| discovered | Found online, check before paying | One public website or directory; nothing checked |

## Sources

Sources live in `knowledge_sources`. A website is added by data, not code: set `benita_enabled = true` and a `benita_config` such as:

```json
{
  "seeds": ["https://example.co.zw/listings"],
  "follow": ["^https://example\\.co\\.zw/listings\\?page=\\d+$"],
  "detail": ["^https://example\\.co\\.zw/listing/[a-z0-9-]+$"],
  "record": "listing",
  "category": "Vehicles",
  "ttl_days": 21,
  "recrawl_hours": 24,
  "pages_per_run": 20
}
```

`record` is `listing` (things for sale or jobs), `business` (directory entries) or `auto` (both, from schema.org data). Use the `probe` action to look at a site the way Benita would before writing its config:

```sql
select benita_call('{"action":"probe","url":"https://example.co.zw/"}'::jsonb);
-- then read net._http_response for that request id
```

### Rules every source follows

- robots.txt is read and obeyed for every page, including its crawl delay (at least 1.5 s between pages).
- Pages behind bot challenges (Cloudflare "Just a moment") are not crawled. Classifieds.co.zw and ZimbabweYP are in this group and need a data partnership instead.
- Only facts are stored: name, price, place, phone, category and the link back. No page text beyond a short description, and no photos.
- Instagram and Facebook are never scraped. Meta's terms forbid automated collection, and TrustHub Connect depends on Meta's WhatsApp API.
- A record a business owner claimed is never overwritten by a crawl.

## Schedules (pg_cron)

| Job | Schedule | Does |
| --- | --- | --- |
| `benita-tick` | every 10 min | One batch for the website that waited longest, facts once a day, then the business mirror |
| `benita-osm` | every 2 min | Sends the next OpenStreetMap task (`benita_osm_tasks`: one per 1-degree cell and kind of place, plus the cell's towns and suburbs), one in flight at a time, busiest towns first, rotating across `lz4`, `z` and the main overpass-api.de server; each task is refreshed every 14 days and retried with back-off if it fails |
| `benita-osm-process` | every 2 min | Parses finished Overpass responses into `benita_places` and `knowledge_records` |
| `benita-housekeeping` | hourly at :17 | Marks jobs stopped by the 150 s function limit as failed; expires web listings past `expires_at` |

Every run writes a row to `knowledge_ingestion_jobs` with records seen, accepted and rejected. The admin overview shows the pile and the latest runs in the **Benita knowledge engine** panel.

## Calling the function

`benita-ingest` accepts `POST` with the header `x-benita-secret` (stored in `benita_settings`, which has no row-level-security policies) or the service-role key. From SQL, use `benita_call(jsonb)`:

```sql
select benita_call('{"action":"web","source":"vacancymail"}'::jsonb);
select benita_osm_next(1);   -- send the next OpenStreetMap task now; benita_osm_process() parses it
select benita_call('{"action":"facts"}'::jsonb);
```

### Why OpenStreetMap runs in the database

Edge functions stop after 150 seconds, and a busy cell like Harare can take Overpass longer than that. One query per kind of place keeps each request small: the combined query for a busy cell gets HTTP 502 from the public servers. pg_net has no such limit, so the database asks Overpass with a 290-second allowance and parses the JSON itself. From Supabase, overpass-api.de and its `lz4` and `z` mirrors answer `GET` requests. They refuse `POST` (HTTP 406) and agents named like generic crawlers, so Overpass calls identify as `TrustHubConnect-Benita/1.0` with a link to this repository. The edge function's `osm` action is kept for manual use on small cells.

## Deploying

The deployed function is a one-line entry that imports `supabase/functions/benita-ingest/index.ts` from this repository at a pinned commit, so production runs exactly what was reviewed. To deploy a change, commit it, then redeploy the entry with the new commit hash.

## Live lookups and memory

When nothing stored answers a directory question, the app calls `benita-ingest` with `{ action: "live", text, city, terms }`.

1. **Memory first.** `benita_live_lookups` keeps one row per question (`hotel|beitbridge`). If the question was looked up recently, nothing is fetched again:
   - when something was found, it is remembered for 30 days;
   - when nothing was found, it is remembered for 3 days.

   `times_asked` counts demand.
2. **OpenStreetMap search (Nominatim).** The database fetches it through `benita_map_search`, because Nominatim refuses requests from the edge network. It is free, and limited to 1 request a second.
3. **Web search, cheapest first:** Tavily, then Exa, then OpenRouter's web plugin. Each key is read from the function secrets (`TAVILY_API_KEY`, `EXA_API_KEY`, `OPENROUTER_API_KEY`) or from `benita_settings` (lower-case key names).

Everything found is saved to `knowledge_records`, so the next person is answered straight from the database.

The nightly `benita-gaps` job looks up again everything that found nothing the day before. It bypasses the 3-day "nothing found" memory.

## Whole-country OpenStreetMap exports (HDX)

`{ action: "hdx", dataset }` downloads a Humanitarian OpenStreetMap Team export of Zimbabwe from HDX (ODbL) and imports it in one run:
- `points_of_interest` (about 10,000 named shops, restaurants, hotels, offices and services);
- `health_facilities`, `education_facilities` and `financial_services`.

Records use the same ids as the Overpass connector (`node:123`), so the two sources merge instead of duplicating. `benita-hdx` refreshes all four every Sunday. This is far faster than the cell-by-cell Overpass tasks, which now run every 10 minutes to stay gentle on the public servers.

## Community intelligence

- **News.** `{ action: "news" }` runs hourly (cron `benita-news`). It reads RSS feeds from ZimPriceCheck, NewsDay, The Zimbabwe Independent, Pindula News, 263Chat, NewsHawks, Techzim and Zimbabwe Situation, and keeps only headlines about prices, money, fuel, power and water, jobs, housing, transport, scams, business and councils. Each item is tagged with its topics and the towns it names. Only the headline, a short summary and the link are stored, in `benita_news`.
- **Signals.** `benita_signals(city)` returns:
  - fuel and ZiG facts, with the previous value;
  - median asking rents by suburb;
  - median asking prices by car model;
  - how many jobs are listed.
- **The brief.** Menu option 7 shows money, news, rents, cars, jobs and what people search for.
- **Chat.** Any question about prices, money or the town gets a free answer. The AI writes it from the news, signals and facts when AI is available; otherwise the matching signals and headlines are shown directly.
- **Listing search.** `benita_listings(...)` searches every live listing in the database by area, budget, rent or buy, and words, and can exclude office space from home searches. When nothing fits the budget, it returns the closest options above it, flagged with `within_budget = false`.
