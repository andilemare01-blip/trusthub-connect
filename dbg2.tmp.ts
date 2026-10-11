import { parseLocalSearchRequest } from "./lib/whatsapp/intent-parser.ts";
console.log(JSON.stringify(parseLocalSearchRequest("I know a good plumber in Harare called Mr Moyo"), null, 1));
