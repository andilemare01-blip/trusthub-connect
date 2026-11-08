/**
 * The branded QR picture a business gets for its review card: TrustHub header, the QR code,
 * the business name, a short instruction and the card code. Built as plain SVG so it works
 * the same on the server, in tests and in the admin page, which turns it into a PNG to download.
 */
import { qrMatrix } from "./qr.ts";

const TEAL = "#0f4f47";
const GOLD = "#f2c14e";
const CREAM = "#f7f3ec";
const INK = "#13201e";
const MUTED = "#4f5f5c";
const FONT = "Poppins, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export interface QrCardOptions {
  /** What the QR code opens (the card's WhatsApp link, or its app link). */
  link: string;
  businessName: string;
  code: string;
  /** The line under the business name. */
  caption?: string;
}

const escapeXml = (text: string) => text.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Width and height of the picture, in pixels at 1x. */
export const QR_CARD_WIDTH = 1000;
export const QR_CARD_HEIGHT = 1300;

export function qrCardSvg({ link, businessName, code, caption = "Scan to review us on WhatsApp" }: QrCardOptions): string {
  const matrix = qrMatrix(link);
  const W = QR_CARD_WIDTH, H = QR_CARD_HEIGHT;
  const box = W - 100;                    // white rounded square holding the code
  const boxX = 50, boxY = 150;
  const modules = matrix.length + 8;      // 4-module quiet zone each side
  const cell = box / modules;
  const path: string[] = [];
  matrix.forEach((row, r) => row.forEach((dark, c) => { if (dark) path.push(`M${c + 4} ${r + 4}h1v1h-1z`); }));

  // Long names get a smaller font so they stay on one line.
  const name = businessName.trim() || "Our business";
  const nameSize = Math.max(34, Math.min(64, Math.floor(1700 / Math.max(name.length, 1))));
  const textY = boxY + box + 90;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="${CREAM}"/>
<rect width="${W}" height="120" fill="${TEAL}"/>
<circle cx="88" cy="60" r="32" fill="${GOLD}"/>
<text x="88" y="73" text-anchor="middle" font-family="${FONT}" font-size="38" font-weight="800" fill="${TEAL}">T</text>
<text x="136" y="58" font-family="${FONT}" font-size="36" font-weight="700" fill="#ffffff">TrustHub</text>
<text x="137" y="92" font-family="${FONT}" font-size="22" fill="#cfe5e0">Connect</text>
<rect x="${boxX}" y="${boxY}" width="${box}" height="${box}" rx="24" fill="#ffffff"/>
<g transform="translate(${boxX} ${boxY}) scale(${cell})" shape-rendering="crispEdges"><path d="${path.join("")}" fill="${TEAL}"/></g>
<text x="${W / 2}" y="${textY}" text-anchor="middle" font-family="${FONT}" font-size="${nameSize}" font-weight="700" fill="${INK}">${escapeXml(name)}</text>
<text x="${W / 2}" y="${textY + 62}" text-anchor="middle" font-family="${FONT}" font-size="34" fill="${MUTED}">${escapeXml(caption)}</text>
<text x="${W / 2}" y="${textY + 118}" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${TEAL}">Card ${escapeXml(code)}</text>
</svg>`;
}

/** A safe file name for the downloaded picture, e.g. "Cafe-Nush-TH-1024-QR.png". */
export function qrCardFileName(businessName: string, code: string): string {
  const slug = businessName.normalize("NFKD").replace(/[\u0300-\u036f'\u2019]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `${slug ? `${slug}-` : ""}${code}-QR.png`;
}
