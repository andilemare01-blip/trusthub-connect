import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryConnectStore, listingPrice, type Listing } from "../lib/connect/store.ts";

const NOW = "2026-10-30T08:00:00.000Z";
const home = (id: string, title: string, area: string, priceText: string, category = "Property"): Listing =>
  ({ id, intent: "offering", category, title, priceText, city: "Harare", area, phone: null, status: "pending", createdAt: NOW } as Listing);

test("a price is read from the number or from text like $1,500 or 1.2k", () => {
  assert.equal(listingPrice("800", null), 800);
  assert.equal(listingPrice(null, "$1,500"), 1500);
  assert.equal(listingPrice(null, "US$ 1.2k"), 1200);
  assert.equal(listingPrice(null, null), null);
});

test("$1200 in Borrowdale finds Borrowdale rentals near that budget, not houses for sale or other suburbs", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.listings.push(
    home("a", "One bedroom cottage to rent close to Sam Levy Village", "Borrowdale", "$800"),
    home("b", "3-Bed Townhouse Available for Rent in Borrowdale", "Borrowdale", "$1,500"),
    home("c", "Ultra Modern 3 bedroom to Rent", "Borrowdale", "$2,000"),
    home("d", "Borrowdale Pomona House for sale", "Pomona", "$295,000"),
    home("e", "Garden flat to rent", "Avondale", "$1,100"),
  );
  const found = await store.searchListings({ intents: ["offering"], words: [], category: "property", city: "Harare", area: "Borrowdale", maxPrice: 1200, deal: "rent", limit: 5 });
  assert.deepEqual(found.map((item) => item.id), ["a"], "within 15% of the budget, in Borrowdale, for rent");
  const roomier = await store.searchListings({ intents: ["offering"], words: [], category: "property", city: "Harare", area: "Borrowdale", maxPrice: 1400, deal: "rent", limit: 5 });
  assert.deepEqual(roomier.map((item) => item.id), ["b", "a"], "closest to the budget first");
});

test("when nothing fits the budget, the closest above it are shown and flagged; office space stays out of a home search", async () => {
  const store = new InMemoryConnectStore(() => NOW);
  store.listings.push(
    home("x", "3-Bed Townhouse for Rent in Borrowdale", "Borrowdale", "$1,500"),
    home("y", "Vacant Office Space To Let In Borrowdale West", "Borrowdale West", "$1,000"),
    home("z", "House to Rent in Borrowdale Brooke", "Borrowdale Brooke", "$3,500"),
  );
  const found = await store.searchListings({ intents: ["offering"], words: [], category: "property", city: "Harare", area: "Borrowdale", maxPrice: 1000, deal: "rent", exclude: "\\m(office|offices|commercial)\\M", limit: 5 });
  assert.deepEqual(found.map((item) => item.id), ["x"], "the $1,500 townhouse is the closest; the office is left out; $3,500 is too far");
  assert.equal(found[0].withinBudget, false);
});
