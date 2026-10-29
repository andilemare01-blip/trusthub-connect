/**
 * OpenStreetMap connector: every named shop, office, craft, clinic, school,
 * restaurant, hotel and similar place in Zimbabwe. ODbL, attribution kept.
 * One run handles one tag key over one tile so it fits the function time limit.
 */
import { rest, source, upsert } from "./db.ts";
import { clean, searchText, USER_AGENT, zwPhone } from "./normalise.ts";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

/**
 * Zimbabwe as 1-degree cells named by their south-west corner ("-18,31" holds Harare).
 * A cell is small enough for one Overpass query to finish well inside the function's 150 s limit.
 */
export const TILES: Record<string, [number, number, number, number]> = {};
for (let lat = -23; lat <= -16; lat++) for (let lon = 25; lon <= 32; lon++) TILES[`${lat},${lon}`] = [lat, lon, lat + 1, lon + 1];

const AMENITY = "restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|bank|atm|bureau_de_change|money_transfer|payment_centre|pharmacy|clinic|hospital|doctors|dentist|veterinary|fuel|charging_station|car_wash|car_rental|vehicle_inspection|driving_school|school|college|university|kindergarten|childcare|language_school|training|library|marketplace|post_office|police|fire_station|courthouse|townhall|community_centre|social_facility|place_of_worship|cinema|nightclub|theatre|events_venue|conference_centre|internet_cafe|bus_station|taxi|ferry_terminal|parcel_locker|laundry|dry_cleaning|funeral_hall|crematorium|studio|arts_centre";
const LEISURE = "fitness_centre|sports_centre|stadium|golf_course|swimming_pool|pitch|dance|park|playground|resort|water_park|marina|bowling_alley|sauna";

export const KEYS: Record<string, string> = {
  shop: "[shop][name]", amenity: `[amenity~"^(${AMENITY})$"][name]`, office: "[office][name]", craft: "[craft][name]",
  tourism: '[tourism~"^(hotel|motel|guest_house|hostel|lodge|chalet|camp_site|caravan_site|apartment|attraction|museum|gallery|zoo|viewpoint|information|picnic_site)$"][name]',
  healthcare: "[healthcare][name]", leisure: `[leisure~"^(${LEISURE})$"][name]`, industrial: "[industrial][name]",
  man_made: '[man_made~"^(works|water_tower|telecommunication)$"][name]',
};

interface Place { name: string; lat: number; lon: number; kind: string }

async function overpass(query: string, waitMs = 100_000): Promise<{ elements: Record<string, unknown>[] }> {
  let last = "";
  const started = Date.now();
  for (const endpoint of ENDPOINTS) {
    const left = waitMs - (Date.now() - started);
    if (left < 10_000) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT }, body: "data=" + encodeURIComponent(query), signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return await response.json();
      last = `${endpoint} ${response.status}`;
    } catch (error) { clearTimeout(timer); last = `${endpoint} ${String(error).slice(0, 100)}`; }
  }
  throw new Error(`Overpass unavailable: ${last}`);
}

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180, dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function places(bbox: [number, number, number, number]): Promise<Place[]> {
  // Pad the cell so a shop near its edge still finds its town.
  const [s, w, n, e] = [bbox[0] - 0.4, bbox[1] - 0.4, bbox[2] + 0.4, bbox[3] + 0.4];
  const data = await overpass(`[out:json][timeout:60];node[place~"^(city|town|village|suburb|neighbourhood|quarter)$"][name](${s},${w},${n},${e});out;`, 60_000);
  return data.elements.map((el) => {
    const tags = (el.tags ?? {}) as Record<string, string>;
    return { name: tags.name, lat: el.lat as number, lon: el.lon as number, kind: tags.place };
  }).filter((place) => place.name && Number.isFinite(place.lat));
}

function locate(lat: number, lon: number, all: Place[]): { city: string | null; area: string | null } {
  let town: Place | null = null, townKm = Infinity, village: Place | null = null, villageKm = Infinity, suburb: Place | null = null, suburbKm = Infinity;
  for (const place of all) {
    const d = km(lat, lon, place.lat, place.lon);
    if ((place.kind === "city" || place.kind === "town") && d < townKm) { town = place; townKm = d; }
    else if (place.kind === "village" && d < villageKm) { village = place; villageKm = d; }
    else if ((place.kind === "suburb" || place.kind === "neighbourhood" || place.kind === "quarter") && d < suburbKm) { suburb = place; suburbKm = d; }
  }
  const reach = town?.kind === "city" ? 35 : 20;
  const city = town && townKm <= reach ? town.name : village && villageKm <= 15 ? village.name : town?.name ?? null;
  return { city, area: suburb && suburbKm <= 3 ? suburb.name : null };
}

const FOOD = new Set(["restaurant", "cafe", "fast_food", "bar", "pub", "food_court", "ice_cream"]);
const HEALTH = new Set(["pharmacy", "clinic", "hospital", "doctors", "dentist"]);
const SCHOOL = new Set(["school", "college", "university", "kindergarten", "childcare", "language_school", "training", "driving_school"]);

function classify(t: Record<string, string>): { recordType: string; category: string; sub: string | null } {
  const sub = t.shop ?? t.craft ?? t.office ?? t.healthcare ?? t.amenity ?? t.tourism ?? t.leisure ?? t.industrial ?? t.man_made ?? null;
  if (t.healthcare || HEALTH.has(t.amenity)) return { recordType: "healthcare", category: "Healthcare", sub };
  if (SCHOOL.has(t.amenity)) return { recordType: "school", category: "Education", sub };
  if (FOOD.has(t.amenity)) return { recordType: "business", category: "Food & Dining", sub };
  if (["bank", "atm", "bureau_de_change", "money_transfer", "payment_centre"].includes(t.amenity)) return { recordType: "business", category: "Finance", sub };
  if (["fuel", "charging_station", "car_wash", "car_rental", "vehicle_inspection"].includes(t.amenity) || /^(car|car_repair|car_parts|tyres|motorcycle)$/.test(t.shop ?? "")) return { recordType: "business", category: "Motoring", sub };
  if (["bus_station", "taxi", "ferry_terminal"].includes(t.amenity)) return { recordType: "transport", category: "Transport", sub };
  if (t.shop) return { recordType: "business", category: /supermarket|convenience|grocer|butcher|bakery|greengrocer|beverages|alcohol/.test(t.shop) ? "Groceries" : "Retail", sub };
  if (t.craft) return { recordType: "service", category: "Trades & Services", sub };
  if (t.office) return { recordType: "business", category: "Business Services", sub };
  if (t.tourism) return { recordType: ["attraction", "museum", "gallery", "zoo", "viewpoint", "picnic_site", "information"].includes(t.tourism) ? "landmark" : "business", category: "Accommodation & Tourism", sub };
  if (t.leisure) return { recordType: "facility", category: "Leisure & Recreation", sub };
  if (t.industrial || t.man_made) return { recordType: "business", category: "Industry", sub };
  if (["police", "fire_station", "courthouse", "townhall", "post_office", "library", "community_centre", "social_facility"].includes(t.amenity)) return { recordType: "facility", category: "Public Services", sub };
  if (t.amenity === "place_of_worship") return { recordType: "facility", category: "Places of Worship", sub };
  return { recordType: "business", category: "General Business", sub };
}

/** One cell, every kind of place ("all") or a single tag key. */
export async function runOsm(key: string, tile: string): Promise<{ seen: number; accepted: number; rejected: number }> {
  const filters = key === "all" ? Object.values(KEYS) : KEYS[key] ? [KEYS[key]] : null;
  const bbox = TILES[tile];
  if (!filters || !bbox) throw new Error(`unknown osm key/tile ${key}/${tile}`);
  const src = await source("osm");
  const [s, w, n, e] = bbox;
  const union = filters.map((filter) => `nwr${filter}(area.zw)(${s},${w},${n},${e});`).join("");
  const [data, towns] = await Promise.all([
    overpass(`[out:json][timeout:100];area["ISO3166-1"="ZW"][admin_level=2]->.zw;(${union});out center tags;`, 105_000),
    places(bbox),
  ]);
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  let rejected = 0;
  for (const el of data.elements) {
    const t = (el.tags ?? {}) as Record<string, string>;
    const lat = (el.lat ?? (el.center as { lat?: number })?.lat) as number | undefined;
    const lon = (el.lon ?? (el.center as { lon?: number })?.lon) as number | undefined;
    const name = clean(t.name, 200);
    if (!name || lat === undefined || lon === undefined || t.disused || t["disused:shop"]) { rejected++; continue; }
    const where = locate(lat, lon, towns);
    const city = clean(t["addr:city"], 80) ?? where.city;
    const area = clean(t["addr:suburb"], 80) ?? where.area;
    const { recordType, category, sub } = classify(t);
    const tags = [sub, t.cuisine, t.brand, t.operator, t.healthcare_speciality, t["service:vehicle:repairs"] ? "repairs" : null].filter(Boolean) as string[];
    const address = [t["addr:housenumber"], t["addr:street"], area, city].filter(Boolean).join(", ") || null;
    const phone = zwPhone(t.phone ?? t["contact:phone"] ?? t["contact:mobile"]);
    rows.push({
      record_type: recordType, name, country_code: "ZW", city, area, category, subcategory: sub?.replace(/_/g, " ") ?? null,
      service_tags: tags.map((tag) => tag.replace(/_/g, " ").slice(0, 60)).slice(0, 8),
      description: clean(t.description, 300), phone, whatsapp: zwPhone(t["contact:whatsapp"]),
      website: clean(t.website ?? t["contact:website"] ?? t.url, 300), address, latitude: lat, longitude: lon,
      opening_hours: t.opening_hours ? { osm: t.opening_hours } : null,
      provenance_state: "OBSERVED", confidence: phone ? 0.7 : 0.6, operating_status: "operating",
      provider_kind: "organization", source_id: src.id, source_record_id: `${el.type}:${el.id}`,
      source_url: `https://www.openstreetmap.org/${el.type}/${el.id}`, source_license: "ODbL 1.0 (© OpenStreetMap contributors)",
      source_retrieved_at: now, source_payload: { tags: t },
      search_text: searchText(name, category, sub, tags, t.description, area, city, t["name:en"], t.alt_name),
    });
  }
  const accepted = await upsert("knowledge_records", rows, "source_id,source_record_id");
  await rest(`knowledge_sources?id=eq.${src.id}`, { method: "PATCH", prefer: "return=minimal", body: JSON.stringify({ benita_last_run_at: now }) });
  return { seen: data.elements.length, accepted, rejected };
}
