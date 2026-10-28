import assert from "node:assert/strict";
import test from "node:test";
import { cardLinks, normalizeCardCode } from "../lib/connect/cards.ts";
import { qrMatrix, qrSvg } from "../lib/connect/qr.ts";
import { parseCardCode } from "../lib/connect/parse.ts";

test("card codes are read the same way on the landing page and in WhatsApp", () => {
  assert.equal(normalizeCardCode("th-1042"), "TH-1042");
  assert.equal(normalizeCardCode("TH1042"), "TH-1042");
  assert.equal(normalizeCardCode("TH-12"), null);
  assert.equal(normalizeCardCode("../admin"), null);
  assert.equal(parseCardCode("REVIEW TH-1042"), "TH-1042");
  assert.equal(parseCardCode("review th1042 please"), "TH-1042");
});

test("each card has one NFC link and one QR link on the production site", () => {
  assert.deepEqual(cardLinks("https://trusthub-connect.vercel.app/", "TH-1042"), {
    nfc: "https://trusthub-connect.vercel.app/r/TH-1042?s=nfc",
    qr: "https://trusthub-connect.vercel.app/r/TH-1042?s=qr",
  });
});

test("the QR encoder picks the smallest version and draws the three finder patterns", () => {
  const short = qrMatrix("TH-1");
  assert.equal(short.length, 21, "a few characters fit version 1");
  const link = qrMatrix("https://trusthub-connect.vercel.app/r/TH-1042?s=qr");
  assert.equal(link.length, 33, "a card link fits version 4");
  for (const [top, left] of [[0, 0], [0, link.length - 7], [link.length - 7, 0]]) {
    assert.equal(link[top][left], true);
    assert.equal(link[top + 1][left + 1], false);
    assert.equal(link[top + 3][left + 3], true);
  }
  assert.deepEqual(qrMatrix("same text"), qrMatrix("same text"), "encoding is deterministic");
  assert.throws(() => qrMatrix("x".repeat(400)));
});

test("the QR SVG keeps a quiet zone and uses the requested colour", () => {
  const svg = qrSvg("TH-1", { size: 100, dark: "#0f4f47" });
  assert.match(svg, /viewBox="0 0 29 29"/);
  assert.match(svg, /fill="#0f4f47"/);
});
