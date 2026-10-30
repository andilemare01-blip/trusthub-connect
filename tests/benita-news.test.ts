import assert from "node:assert/strict";
import test from "node:test";
import { parseFeed } from "../supabase/functions/benita-ingest/newsparse.ts";

const feed = `<?xml version="1.0"?><rss><channel>
<item><title><![CDATA[Bread price goes up by 10c in Harare]]></title><link>https://example.co.zw/bread</link><pubDate>Thu, 29 Oct 2026 08:00:00 +0000</pubDate><description><![CDATA[Bakers say flour costs rose. The post Bread price goes up appeared first on Example.]]></description></item>
<item><title>Dynamos appoint new coach after league defeat</title><link>https://example.co.zw/sport</link></item>
<item><title>Police warn of fake ZESA token scam in Bulawayo</title><link>https://example.co.zw/scam</link><description>Residents lost money.</description></item>
<item><title>Man stabbed in Mbare</title><link>https://example.co.zw/crime</link></item>
</channel></rss>`;

test("only headlines about people's pockets and daily life are kept, with topics and towns", () => {
  const items = parseFeed(feed);
  assert.deepEqual(items.map((item) => item.url), ["https://example.co.zw/bread", "https://example.co.zw/scam"]);
  assert.ok(items[0].topics.includes("prices"));
  assert.deepEqual(items[0].towns, ["Harare"]);
  assert.equal(items[0].summary, "Bakers say flour costs rose.");
  assert.equal(items[0].publishedAt, "2026-10-29T08:00:00.000Z");
  assert.ok(items[1].topics.includes("scams") && items[1].topics.includes("power_water"));
  assert.deepEqual(items[1].towns, ["Bulawayo"]);
});
