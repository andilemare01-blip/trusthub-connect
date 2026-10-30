import assert from "node:assert/strict";
import test from "node:test";
import { fromHits, genericName } from "../supabase/functions/benita-ingest/webhits.ts";

test("a web page becomes one named business; list pages, social sites and other towns are dropped", () => {
  const found = fromHits([
    { title: "Rainbow Beitbridge Hotel - Updated 2026 Prices", url: "https://www.booking.com/hotel/zw/rainbow-beitbridge.html", content: "Rainbow Beitbridge Hotel in Beitbridge. Call +263 286 22301." },
    { title: "THE 10 BEST Hotels in Beitbridge", url: "https://www.tripadvisor.com/Hotels-g1-Beitbridge.html", content: "hotel Beitbridge" },
    { title: "Beitbridge Lodge", url: "https://www.facebook.com/beitbridgelodge", content: "lodge Beitbridge" },
    { title: "Harare Hotel", url: "https://harare-hotel.co.zw", content: "hotel in Harare" },
    { title: "Plumbing Installations & Repairs In Zimbabwe", url: "https://coreconstruction.co.zw/plumbing", content: "plumbing Beitbridge 0772 123 456" },
  ], "Beitbridge", ["hotel", "lodge", "plumbing"]);
  assert.deepEqual(found.map((item) => item.name), ["Rainbow Beitbridge Hotel", "coreconstruction.co.zw"]);
  assert.equal(found[0].phone, "+26328622301");
  assert.equal(found[0].website, null, "a booking site is not the hotel's own website");
  assert.equal(found[1].phone, "+263772123456");
});

test("a name is only treated as a description when it has no name in it", () => {
  assert.equal(genericName("Plumbing Services & Repairs", "Gweru", ["plumber", "plumbing"]), true);
  assert.equal(genericName("Hotel Victoria", "Masvingo", ["hotel"]), false);
  assert.equal(genericName("Best Plumbers in Gweru", "Gweru", ["plumber"]), true);
});
