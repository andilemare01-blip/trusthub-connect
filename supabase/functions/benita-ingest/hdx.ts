/**
 * Whole-country OpenStreetMap exports from the Humanitarian Data Exchange (HOT exports, ODbL).
 * One file holds every mapped shop, restaurant, hotel, office and service in Zimbabwe, so this fills
 * the country in minutes instead of waiting on the busy public Overpass servers cell by cell.
 * Records share their ids with the Overpass connector ("node:123"), so the two never duplicate.
 */
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import { rest, source, upsert } from "./db.ts";
import { clean, searchText, zwPhone } from "./normalise.ts";
import { classify, locate, TOWNS, type Place } from "./osm.ts";

const BASE = "https://production-raw-data-api.s3.amazonaws.com/ISO3/ZWE";
export const DATASETS: Record<string, string> = {
  points_of_interest: `${BASE}/points_of_interest/hotosm_zwe_points_of_interest_osm_geojson.zip`,
  health_facilities: `${BASE}/health_facilities/hotosm_zwe_health_facilities_osm_geojson.zip`,
  education_facilities: `${BASE}/education_facilities/hotosm_zwe_education_facilities_osm_geojson.zip`,
  financial_services: `${BASE}/financial_services/hotosm_zwe_financial_services_osm_geojson.zip`,
};
const KIND_KEY = /^(shop|amenity|tourism|office|craft|healthcare|leisure|industrial)$/;
const OSM_TYPE: Record<string, string> = { nodes: "node", node: "node", ways_poly: "way", ways_line: "way", way: "way", relations: "relation", relation: "relation" };

async function allPlaces(): Promise<Place[]> {
  const rows = await rest<{ name: string; kind: string; lat: number; lon: number }[]>("benita_places?select=name,kind,lat,lon&limit=20000").catch(() => []);
  const known = rows.filter((row) => row.name && Number.isFinite(row.lat));
  return known.some((row) => row.kind === "city" || row.kind === "town") ? [...known, ...TOWNS] : TOWNS;
}

/** The centre of a point, line or polygon. */
function centre(geometry: { type: string; coordinates: unknown } | null): [number, number] | null {
  if (!geometry) return null;
  const points: number[][] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === "number") points.push(value as number[]);
    else if (Array.isArray(value)) value.forEach(walk);
  };
  walk(geometry.coordinates);
  if (!points.length) return null;
  const lon = points.reduce((sum, p) => sum + p[0], 0) / points.length, lat = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
}

/** The first few raw records of a dataset, to check its field names. */
export async function peekHdx(dataset: string): Promise<unknown> {
  const response = await fetch(DATASETS[dataset]);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const name = Object.keys(files).find((file) => /\.geojson$/i.test(file))!;
  const collection = JSON.parse(strFromU8(files[name])) as { features: unknown[] };
  return { files: Object.keys(files), count: collection.features.length, sample: collection.features.slice(0, 2) };
}

export async function runHdx(dataset: string): Promise<{ seen: number; accepted: number; rejected: number }> {
  const url = DATASETS[dataset];
  if (!url) throw new Error(`unknown dataset ${dataset}`);
  const response = await fetch(url, { headers: { "user-agent": "TrustHubConnect-Benita/1.0 (+https://github.com/andilemare01-blip/trusthub-connect)" } });
  if (!response.ok) throw new Error(`download ${response.status}`);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const name = Object.keys(files).find((file) => /\.geojson$/i.test(file));
  if (!name) throw new Error("no GeoJSON in the download");
  const collection = JSON.parse(strFromU8(files[name])) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: unknown } | null }[] };
  const [src, places] = await Promise.all([source("osm"), allPlaces()]);
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let rejected = 0;
  for (const feature of collection.features) {
    const p = feature.properties ?? {};
    const t: Record<string, string> = {};
    for (const [key, value] of Object.entries(p)) if (value !== null && value !== undefined && value !== "") t[key] = String(value);
    const name = clean(t.name ?? t["name:en"], 200);
    const at = centre(feature.geometry);
    const osmType = OSM_TYPE[String(t.osm_type ?? "")];
    if (!name || !at || !osmType || !t.osm_id || !Object.keys(t).some((key) => KIND_KEY.test(key)) || t.disused) { rejected++; continue; }
    const [lat, lon] = at;
    const where = locate(lat, lon, places);
    const city = clean(t["addr:city"], 80) ?? where.city;
    const area = clean(t["addr:suburb"], 80) ?? where.area;
    const { recordType, category, sub } = classify(t);
    const phone = zwPhone(t.phone ?? t["contact:phone"] ?? t["contact:mobile"]);
    const tags = [sub, t.cuisine, t.brand, t.operator, t["healthcare:speciality"], t.religion, t.isced_level ? "school" : null].filter(Boolean) as string[];
    rows.push({
      record_type: recordType, name, country_code: "ZW", city, area, category, subcategory: sub?.replace(/_/g, " ") ?? null,
      service_tags: tags.map((tag) => tag.replace(/_/g, " ").slice(0, 60)).slice(0, 8),
      description: clean(t.description, 300), phone, whatsapp: zwPhone(t["contact:whatsapp"]),
      website: clean(t.website ?? t["contact:website"] ?? t.url, 300),
      address: clean(t["addr:full"], 200) ?? ([t["addr:housenumber"], t["addr:street"], area, city].filter(Boolean).join(", ") || null),
      latitude: lat, longitude: lon, opening_hours: t.opening_hours ? { osm: t.opening_hours } : null,
      provenance_state: "OBSERVED", confidence: phone ? 0.7 : 0.6, operating_status: "operating", provider_kind: "organization",
      source_id: src.id, source_record_id: `${osmType}:${t.osm_id}`, source_url: `https://www.openstreetmap.org/${osmType}/${t.osm_id}`,
      source_license: "ODbL 1.0 (© OpenStreetMap contributors)", source_retrieved_at: now, source_payload: { tags: t, via: `hdx:${dataset}` },
      search_text: searchText(name, category, sub, tags, t.description, area, city, t["name:en"], t.alt_name),
    });
  }
  const unique = [...new Map(rows.map((row) => [String(row.source_record_id), row])).values()];
  const accepted = await upsert("knowledge_records", unique, "source_id,source_record_id", 500);
  await rest(`knowledge_sources?id=eq.${src.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ benita_last_run_at: now }) });
  return { seen: collection.features.length, accepted, rejected };
}
