import assert from "node:assert/strict";
import test from "node:test";
import { change, intelligenceBrief, intelligenceFallback, isIntelligenceQuestion } from "../lib/connect/intelligence.ts";
import type { NewsItem, TownSignals } from "../lib/connect/store.ts";

const signals: TownSignals = {
  facts: [
    { key: "fx.usd_zwg", label: "ZiG per USD", value: 26.6053, previous: 26.5, unit: "ZWG per USD", currency: "ZWG", asOf: "2026-10-29" },
    { key: "fuel.diesel", label: "Diesel", value: 2.04, previous: 2.04, unit: "per litre", currency: "USD", asOf: "2026-10-29" },
    { key: "fuel.petrol_blend", label: "Petrol", value: 2.05, previous: null, unit: "per litre", currency: "USD", asOf: "2026-10-29" },
  ],
  rents: [{ area: "Avondale", median: 900, listings: 13 }, { area: "Avenues", median: 1100, listings: 19 }],
  cars: [{ model: "Toyota Land", median: 67500, listings: 19 }, { model: "Honda Fit", median: 10800, listings: 17 }],
  jobsTotal: 436,
};
const news: NewsItem[] = [{ title: "The RBZ cut its rate to 27.5%", summary: "Loans may not get cheaper.", url: "https://www.zimpricecheck.com/rbz", source: "ZimPriceCheck", publishedAt: "2026-10-29T08:00:00Z", topics: ["money"] }];

test("price changes read plainly", () => {
  assert.equal(change(26.6053, 26.5), " (▲ up 0.4%)");
  assert.equal(change(2.04, 2.04), " (no change)");
  assert.equal(change(2.05, null), "");
});

test("the brief reads like a friend's update: money, news, rents, cars and jobs", () => {
  const brief = intelligenceBrief("Harare", "Hey Andile! Lizzie here with the latest 👇", signals, news, null);
  assert.match(brief, /^Hey Andile! Lizzie here/);
  assert.match(brief, /1 US\$ = ZiG 26\.61 \(▲ up 0\.4%\)/);
  assert.match(brief, /petrol \$2\.05 · diesel \$2\.04 \(no change\)/);
  assert.match(brief, /The RBZ cut its rate to 27\.5% _\(ZimPriceCheck, 29 Oct\)_\nhttps:\/\/www\.zimpricecheck\.com\/rbz/);
  assert.match(brief, /Avondale ~\$900 · Avenues ~\$1,100/);
  assert.match(brief, /Toyota Land Cruiser ~\$67,500/);
  assert.match(brief, /436 openings/);
  assert.match(brief, /Ask me anything/);
  assert.match(intelligenceBrief("Gokwe", "Hi!", null, [], null), /early days for Gokwe/);
});

test("questions stay in Community intelligence; searches go back to the normal flow", () => {
  for (const text of ["is bread going up?", "rent in Avondale", "any news on ZESA", "what is the ZiG rate", "fuel"]) assert.equal(isIntelligenceQuestion(text), true, text);
  for (const text of ["plumber in Harare", "Honda Fit"]) assert.equal(isIntelligenceQuestion(text), false, text);
});

test("without AI, answers come from the matching signals and headlines, and say so when there is nothing", () => {
  assert.match(intelligenceFallback("rent in Avondale?", "Harare", signals, []), /Typical rent asked in Avondale: ~\$900 a month \(from 13 listings\)/);
  assert.match(intelligenceFallback("what's the rate today", "Harare", signals, news), /ZiG 26\.61[\s\S]*In the news:[\s\S]*RBZ/);
  assert.match(intelligenceFallback("pizza", "Harare", null, []), /I haven't seen anything on that yet/);
});
