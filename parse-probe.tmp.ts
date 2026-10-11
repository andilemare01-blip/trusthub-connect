import { parseLocalSearchRequest } from "./lib/whatsapp/intent-parser.ts";
import { detectContribution } from "./lib/contributions/detection.ts";

const cases = [
  "Find a driving school in Harare.",
  "I need somewhere to learn driving.",
  "Any hair salons in Harare?",
  "How about a car rental company?",
  "What about car hire?",
  "And in Chitungwiza?",
  "Show me only the ones with phone numbers.",
  "I'd like to create my TrustHub profile.",
  "I'm looking for a plumber in Harare",
  "I need a mechanic in Chinhoyi",
  "Find me a restaurant in Chiredzi",
  "I'm looking for a driving school in Harare",
  "I want to suggest something for my community",
  "I know a good plumber in Harare called Mr Moyo",
  "Yes",
  "No",
  "Recommend a driving school in Harare",
  "where can i learn to drive",
  "my tap is leaking",
  "car hire in harare",
  "rent a car in bulawayo",
  "hairdresser in harare",
  "plumber harare",
];

for (const text of cases) {
  const r = parseLocalSearchRequest(text);
  const c = detectContribution(text);
  console.log(`${JSON.stringify(text).padEnd(52)} -> ${r ? `req cat=${JSON.stringify(r.category)} city=${JSON.stringify(r.location?.city)} qtype=${r.questionType} concept=${r.serviceConcept ?? "-"}` : "UNDEFINED"}${c ? ` | contrib ${c.kind}/${c.category}/${c.city}` : ""}`);
}