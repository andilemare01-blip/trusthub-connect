import { parseLocalSearchRequest } from "./lib/whatsapp/intent-parser.ts";
const phrase = "a good plumber in Harare called Mr Moyo";
const named = phrase.match(/\b(?:called|named|known as)\s+([\p{L}][\p{L}\s'.-]{1,40})$/u);
console.log("named match:", JSON.stringify(named));
console.log("index:", named?.index, "phrase length:", phrase.length);
if (named) console.log("withoutName:", JSON.stringify(phrase.slice(0, named.index).trim()));
console.log("result:", JSON.stringify(parseLocalSearchRequest("I know a good plumber in Harare called Mr Moyo")));
