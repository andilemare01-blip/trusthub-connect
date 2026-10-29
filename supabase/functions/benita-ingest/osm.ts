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

/** Tries each public Overpass server in turn, each with its own time limit, inside one overall budget. */
async function overpass(query: string, budgetMs: number, perServerMs: number): Promise<{ elements: Record<string, unknown>[] }> {
  const failures: string[] = [];
  const started = Date.now();
  for (const endpoint of ENDPOINTS) {
    const left = Math.min(perServerMs, budgetMs - (Date.now() - started));
    if (left < 8_000) break;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), left);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": USER_AGENT }, body: "data=" + encodeURIComponent(query), signal: controller.signal });
      if (response.ok) { const data = await response.json(); clearTimeout(timer); return data; }
      failures.push(`${new URL(endpoint).host} HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${new URL(endpoint).host} ${error instanceof Error && error.name === "AbortError" ? `no answer in ${Math.round(left / 1000)} s` : String(error).slice(0, 80)}`);
    } finally { clearTimeout(timer); }
  }
  console.warn(JSON.stringify({ event: "benita.overpass_failed", failures }));
  throw new Error(`Overpass unavailable: ${failures.join("; ")}`);
}

/** Towns and cities used to name a place's town when the live place lookup is slow. Coordinates are approximate centres. */
const TOWNS: Place[] = ([
  ["Harare", -17.829, 31.052, "city"], ["Chitungwiza", -18.012, 31.076, "city"], ["Epworth", -17.89, 31.147, "town"], ["Ruwa", -17.89, 31.245, "town"], ["Norton", -17.883, 30.7, "town"],
  ["Bulawayo", -20.15, 28.583, "city"], ["Mutare", -18.971, 32.671, "city"], ["Gweru", -19.45, 29.817, "city"], ["Kwekwe", -18.928, 29.815, "city"], ["Kadoma", -18.333, 29.917, "city"],
  ["Masvingo", -20.064, 30.828, "city"], ["Chinhoyi", -17.367, 30.2, "town"], ["Marondera", -18.185, 31.552, "town"], ["Bindura", -17.302, 31.331, "town"], ["Victoria Falls", -17.932, 25.831, "city"],
  ["Hwange", -18.367, 26.5, "town"], ["Beitbridge", -22.217, 30.0, "town"], ["Zvishavane", -20.327, 30.067, "town"], ["Chegutu", -18.13, 30.141, "town"], ["Kariba", -16.517, 28.8, "town"],
  ["Karoi", -16.81, 29.693, "town"], ["Rusape", -18.535, 32.135, "town"], ["Chiredzi", -21.05, 31.667, "town"], ["Redcliff", -19.033, 29.783, "town"], ["Shurugwi", -19.67, 30.0, "town"],
  ["Chipinge", -20.188, 32.624, "town"], ["Nyanga", -18.217, 32.75, "town"], ["Plumtree", -20.483, 27.817, "town"], ["Gwanda", -20.939, 29.019, "town"], ["Lupane", -18.931, 27.807, "town"],
  ["Mvurwi", -17.033, 30.85, "town"], ["Mount Darwin", -16.773, 31.584, "town"], ["Murehwa", -17.65, 31.783, "town"], ["Banket", -17.383, 30.4, "town"], ["Gokwe", -18.217, 28.933, "town"],
  ["Chivhu", -19.021, 30.892, "town"], ["Mutoko", -17.397, 32.227, "town"], ["Kezi", -20.917, 28.467, "town"], ["Binga", -17.62, 27.34, "town"], ["Triangle", -21.033, 31.45, "town"],
  ["Mashava", -20.05, 30.483, "town"], ["Shamva", -17.317, 31.567, "town"], ["Guruve", -16.65, 30.7, "town"], ["Chimanimani", -19.8, 32.867, "town"], ["Penhalonga", -18.9, 32.683, "town"],
  ["Esigodini", -20.283, 28.933, "town"], ["Filabusi", -20.533, 29.283, "town"], ["Mberengwa", -20.483, 29.917, "town"], ["Zaka", -20.333, 31.467, "town"], ["Gutu", -19.65, 31.167, "town"],
] as [string, number, number, string][]).map(([name, lat, lon, kind]) => ({ name, lat, lon, kind }));

function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180, dLat = (bLat - aLat) * rad, dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

async function places(bbox: [number, number, number, number]): Promise<Place[]> {
  // Pad the cell so a shop near its edge still finds its town.
  const [s, w, n, e] = [bbox[0] - 0.4, bbox[1] - 0.4, bbox[2] + 0.4, bbox[3] + 0.4];
  try {
    const data = await overpass(`[out:json][timeout:40];node[place~"^(city|town|village|suburb|neighbourhood)$"][name](${s},${w},${n},${e});out;`, 45_000, 25_000);
    const live = data.elements.map((el) => {
      const tags = (el.tags ?? {}) as Record<string, string>;
      return { name: tags.name, lat: el.lat as number, lon: el.lon as number, kind: tags.place };
    }).filter((place) => place.name && Number.isFinite(place.lat));
    return live.some((place) => place.kind === "city" || place.kind === "town") ? live : [...live, ...TOWNS];
  } catch {
    // Without suburbs a place still gets its town, so a slow lookup never costs the whole cell.
    return TOWNS;
  }
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
    overpass(`[out:json][timeout:90];area["ISO3166-1"="ZW"][admin_level=2]->.zw;(${union});out center tags;`, 125_000, 70_000),
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
