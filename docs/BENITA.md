# Benita: the knowledge engine behind TrustHub Connect

Benita collects public information about Zimbabwean businesses, things for sale, jobs and everyday facts, cleans it, and serves it to Wisdom through one search. Every result carries an honest trust label, so the bot can always answer without overclaiming.

## How the pieces fit

| Piece | Where | What it does |
| --- | --- | --- |
| `benita-ingest` | `supabase/functions/benita-ingest/` (Supabase edge function) | Collects data: OpenStreetMap cells, configured websites, ZERA fuel prices and the RBZ exchange rate |
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
| `benita-osm` | every 4 min | One OpenStreetMap cell (`benita_osm_cells`); every cell is refreshed every 14 days |
| `benita-housekeeping` | hourly at :17 | Marks jobs stopped by the 150 s function limit as failed; expires web listings past `expires_at` |

Every run writes a row to `knowledge_ingestion_jobs` with records seen, accepted and rejected. The admin overview shows the pile and the latest runs in the **Benita knowledge engine** panel.

## Calling the function

`benita-ingest` accepts `POST` with the header `x-benita-secret` (stored in `benita_settings`, which has no row-level-security policies) or the service-role key. From SQL, use `benita_call(jsonb)`:

```sql
select benita_call('{"action":"web","source":"vacancymail"}'::jsonb);
select benita_call('{"action":"osm","key":"all","tile":"-18,31"}'::jsonb);   -- Harare's cell
select benita_call('{"action":"facts"}'::jsonb);
```

## Deploying

The deployed function is a one-line entry that imports `supabase/functions/benita-ingest/index.ts` from this repository at a pinned commit, so production runs exactly what was reviewed. To deploy a change, commit it, then redeploy the entry with the new commit hash.
