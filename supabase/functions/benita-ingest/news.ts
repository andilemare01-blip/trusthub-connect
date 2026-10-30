/**
 * News for Community intelligence: headlines from Zimbabwean news feeds, kept only when they are about
 * people's pockets and daily life (prices, money, fuel, power, jobs, rent, transport, scams, business).
 * Only the headline, a short summary and the link are stored; readers go to the publisher for the article.
 */
import { upsert } from "./db.ts";
import { parseFeed } from "./newsparse.ts";
import { allowed, robotsFor } from "./robots.ts";

export const FEEDS: { key: string; name: string; url: string }[] = [
  { key: "zimpricecheck", name: "ZimPriceCheck", url: "https://www.zimpricecheck.com/feed/" },
  { key: "newsday", name: "NewsDay", url: "https://www.newsday.co.zw/feed" },
  { key: "theindependent", name: "The Zimbabwe Independent", url: "https://www.theindependent.co.zw/feed" },
  { key: "pindula", name: "Pindula News", url: "https://news.pindula.co.zw/feed/" },
  { key: "263chat", name: "263Chat", url: "https://www.263chat.com/feed/" },
  { key: "newshawks", name: "NewsHawks", url: "https://thenewshawks.com/feed/" },
  { key: "techzim", name: "Techzim", url: "https://www.techzim.co.zw/feed/" },
  { key: "zimbabwesituation", name: "Zimbabwe Situation", url: "https://www.zimbabwesituation.com/feed/" },
];

export async function runNews(): Promise<{ seen: number; accepted: number; rejected: number }> {
  let seen = 0, accepted = 0, rejected = 0;
  for (const feed of FEEDS) {
    try {
      const rules = await robotsFor(feed.url);
      if (!allowed(feed.url, rules)) { rejected++; continue; }
      const response = await fetch(feed.url, { headers: { "user-agent": "BenitaBot/1.0 (TrustHub Connect news reader; respects robots.txt)", accept: "application/rss+xml, application/xml, text/xml" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) { rejected++; continue; }
      const xml = await response.text();
      const items = parseFeed(xml);
      seen += (xml.match(/<item[\s>]/gi) ?? []).length;
      if (!items.length) continue;
      accepted += await upsert("benita_news", items.map((item) => ({
        url: item.url, title: item.title, summary: item.summary, source_key: feed.key, source_name: feed.name,
        published_at: item.publishedAt ?? new Date().toISOString(), topics: item.topics, towns: item.towns, fetched_at: new Date().toISOString(),
      })), "url");
    } catch (error) {
      console.warn(JSON.stringify({ event: "benita.news_feed_failed", feed: feed.key, error: String(error).slice(0, 120) }));
      rejected++;
    }
  }
  return { seen, accepted, rejected };
}
