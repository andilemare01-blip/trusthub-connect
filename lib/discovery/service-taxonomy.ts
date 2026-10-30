/**
 * Deterministic service taxonomy: canonical service concepts, the words businesses use in names and
 * categories (`terms`), and the ordinary phrases people use when asking for them (`asks`).
 * No AI, network or database access. A match is only a relevance signal; it never implies verification.
 */
export interface ServiceConcept {
  id: string;
  family: string;
  label: string;
  /** How businesses name or categorise themselves; used to match records. */
  terms: string[];
  /** Phrases people say when they need the service; used to understand requests. */
  asks: string[];
  /** Phrases that mean a record is something else even if it contains a term (e.g. "driving school" is not a school). */
  excludes: string[];
}

const c = (id: string, family: string, label: string, terms: string[], asks: string[] = [], excludes: string[] = []): ServiceConcept => ({ id, family, label, terms, asks, excludes });

export const SERVICE_CONCEPTS: ServiceConcept[] = [
  // Automotive
  c("driving_school", "automotive", "driving school", ["driving school", "driving lessons", "driving lesson", "driving instructor", "driving academy", "driver training", "drivers training", "motoring school", "driving centre", "driving center", "learner driver"], ["learn to drive", "learning to drive", "learn how to drive", "teach me to drive", "get a licence", "get a license", "drivers licence", "drivers license", "driving licence", "driving license", "learners licence", "learners license", "learner licence", "vid test", "road test", "k53"]),
  c("mechanic", "automotive", "mechanic", ["mechanic", "auto repair", "car repair", "vehicle repair", "motor repair", "motor mechanic", "auto mechanic", "auto electrician", "panel beater", "panel beating", "garage", "motor garage", "vehicle service", "car service"], ["car wont start", "car will not start", "vehicle wont start", "engine problem", "engine trouble", "car overheating", "car is overheating", "car broke down", "car is making a noise", "service my car", "fix my car", "repair my car", "brakes are not working", "gearbox problem", "check engine light"]),
  c("roadside_assistance", "automotive", "roadside assistance", ["roadside assistance", "roadside rescue", "towing", "tow truck", "towing service", "breakdown service", "breakdown assistance", "car recovery", "vehicle recovery", "jump start"], ["car wont start", "car will not start", "vehicle wont start", "car broke down", "broke down on the road", "stuck on the road", "stranded on the road", "flat battery", "dead battery", "need a tow"]),
  c("tyre_shop", "automotive", "tyre shop", ["tyre", "tire", "tyre shop", "tyre fitment", "wheel alignment", "wheel balancing", "vulcanising", "vulcanizing", "vulcaniser", "puncture repair"], ["flat tyre", "flat tire", "puncture", "burst tyre", "need new tyres", "buy tyres"]),
  c("car_wash", "automotive", "car wash", ["car wash", "carwash", "car valet", "valeting", "vehicle wash", "car cleaning", "car detailing"], ["wash my car", "clean my car", "get my car washed"]),
  c("vehicle_hire", "automotive", "vehicle hire", ["car hire", "car rental", "vehicle hire", "vehicle rental", "rent a car", "hire a car", "bakkie hire", "van hire", "truck hire", "4x4 hire", "self drive"], ["hire a vehicle", "rent a vehicle", "need a car for the weekend"]),
  c("car_dealership", "automotive", "car dealership", ["car dealer", "car dealership", "car dealers", "car sales", "used cars", "second hand cars", "motor dealer", "vehicle sales", "car yard", "auto sales", "motors"], ["buy a car", "buy a vehicle", "second hand car", "sell my car", "sell my vehicle"]),
  c("auto_parts", "automotive", "auto parts", ["auto parts", "car parts", "spares", "spare parts", "motor spares", "car spares", "auto spares", "vehicle parts"], ["need a spare part for my car", "buy car parts"]),
  // Home services
  c("plumber", "home", "plumber", ["plumber", "plumbing", "plumbing services", "drain cleaning", "drainage", "geyser installation", "geyser repair"], ["tap is leaking", "my tap is leaking", "leaking tap", "tap leaking", "burst pipe", "blocked drain", "blocked toilet", "toilet is blocked", "leaking pipe", "geyser is leaking", "water leak", "pipe is leaking"]),
  c("electrician", "home", "electrician", ["electrician", "electrical", "electrical services", "electrical contractor", "electrical contractors", "wiring"], ["power is out in my house", "no electricity in my house", "lights are not working", "socket is not working", "tripping switch", "short circuit", "fix my wiring", "install lights"]),
  c("builder", "home", "builder", ["builder", "building contractor", "building services", "bricklayer", "bricklaying", "roofing", "roofer", "building works", "home improvement", "construction", "construction company", "construction services", "civil engineering", "civil contractor", "contractor", "building construction"], ["build a house", "build me a house", "building a house", "renovate my house", "house renovation", "renovations", "fix my roof", "my roof is leaking", "build an extension", "build a road", "civil works"]),
  c("painter", "home", "painter", ["painter", "painting", "painting services", "house painter", "paint contractor", "painting contractor"], ["paint my house", "paint the house", "repaint my house", "need my house painted", "paint my walls"]),
  c("cleaning", "home", "cleaning services", ["cleaning services", "cleaning company", "cleaners", "cleaner", "domestic cleaning", "office cleaning", "carpet cleaning", "janitorial", "maid", "maid service", "domestic worker", "house cleaning"], ["clean my house", "clean my office", "need a maid", "need a cleaner", "need someone to clean"]),
  c("gardening", "home", "gardening", ["gardener", "gardening", "garden services", "landscaping", "landscaper", "lawn mowing", "lawn care", "tree felling", "tree cutting"], ["mow my lawn", "cut my grass", "cut my lawn", "garden service", "my garden is overgrown"]),
  c("appliance_repair", "home", "appliance repair", ["appliance repair", "fridge repair", "freezer repair", "washing machine repair", "stove repair", "tv repair", "microwave repair", "white goods repair", "appliance technician", "refrigeration", "air conditioning repair", "aircon repair"], ["fridge is not cooling", "my fridge is not cooling", "fridge not working", "washing machine is broken", "washing machine not working", "stove is not working", "tv is not working", "fix my fridge", "fix my washing machine"]),
  c("carpenter", "home", "carpenter", ["carpenter", "carpentry", "joinery", "joiner", "woodwork", "cabinet maker", "cabinet makers", "kitchen cupboards"], ["make me a cupboard", "build kitchen cupboards", "make a wardrobe", "fix my door"]),
  c("welder", "home", "welder", ["welder", "welding", "metal fabrication", "fabricator", "steel fabrication", "burglar bars", "gates and burglar bars", "steel gates", "palisade fencing"], ["make a gate", "make burglar bars", "weld my gate", "need welding"]),
  c("security_services", "home", "security services", ["security company", "security services", "security guards", "guarding", "guard services", "alarm systems", "alarm installation", "cctv", "electric fencing", "armed response"], ["need a security guard", "need security for my house", "install an alarm", "install cameras", "protect my house"]),
  c("solar", "home", "solar and backup power", ["solar", "solar installer", "solar installation", "solar panels", "solar power", "solar geyser", "inverter", "inverters", "battery backup", "backup power", "lithium batteries", "generator", "generators", "generator repair"], ["solar for my house", "need solar", "power backup", "load shedding solution", "backup power for my house", "buy an inverter", "install solar", "no power during load shedding"]),
  // Food and hospitality
  c("restaurant", "food", "restaurant", ["restaurant", "eatery", "diner", "grill", "steakhouse", "pizzeria", "bistro", "dining", "braai", "nyama", "sit down restaurant", "family restaurant"], ["where can i eat", "somewhere to eat", "place to eat", "i am hungry", "hungry", "lunch spot", "dinner spot", "good food", "where to eat", "eat out", "go out for dinner"]),
  c("takeaway", "food", "takeaway", ["takeaway", "take away", "fast food", "takeout", "take out", "food delivery", "pizza", "burger", "fish and chips", "chicken and chips", "drive through"], ["order food", "food delivered", "get food delivered", "deliver food", "buy a burger", "buy pizza"]),
  c("cafe", "food", "cafe", ["cafe", "coffee shop", "coffee house", "tea room", "tearoom", "coffee"], ["get a coffee", "somewhere for coffee", "place for coffee"]),
  c("bakery", "food", "bakery", ["bakery", "baker", "bread", "confectionery", "cake shop", "pastry", "pastries", "cakes"], ["buy bread", "buy a cake", "order a cake", "birthday cake", "wedding cake", "where can i get bread"]),
  c("catering", "food", "catering", ["catering", "caterer", "catering services", "event catering", "outside catering", "buffet", "cater"], ["food for my wedding", "food for a function", "food for a party", "cater for my event", "cater for a funeral"]),
  c("accommodation", "hospitality", "accommodation", ["accommodation", "hotel", "lodge", "motel", "resort", "inn", "guest house", "guesthouse", "bed and breakfast", "bnb", "b and b", "backpackers", "hostel", "lodging", "self catering", "chalet", "airbnb", "short stay", "guest lodge", "rest camp", "campsite"], ["place to stay", "somewhere to stay", "where can i stay", "where to stay", "need a room", "book a room", "room for the night", "somewhere to sleep", "where to sleep", "need a place to sleep", "need a hotel", "spend the night"]),
  // Health
  c("clinic", "health", "clinic", ["clinic", "medical centre", "medical center", "health centre", "health center", "doctor", "gp", "general practitioner", "surgery", "polyclinic", "family doctor", "medical practice", "medical clinic"], ["see a doctor", "need a doctor", "feeling sick", "i am sick", "i have a fever", "medical help", "need medical attention", "doctors consultation"]),
  c("hospital", "health", "hospital", ["hospital", "emergency room", "casualty", "maternity home", "maternity", "referral hospital", "private hospital", "ambulance", "ambulance service", "trauma centre"], ["need an ambulance", "emergency medical", "need to go to hospital", "someone is badly hurt"]),
  c("dentist", "health", "dentist", ["dentist", "dental", "dental clinic", "dental surgery", "orthodontist", "dental care"], ["toothache", "tooth ache", "tooth pain", "broken tooth", "teeth cleaning", "get braces", "pull a tooth", "my tooth hurts"]),
  c("pharmacy", "health", "pharmacy", ["pharmacy", "chemist", "drug store", "dispensary", "medicine shop", "pharmacist"], ["buy medicine", "need medicine", "get medication", "prescription", "fill a prescription", "buy tablets", "painkillers", "where can i buy medicine"]),
  c("optician", "health", "optician", ["optician", "optometrist", "optometry", "eye clinic", "eye test", "glasses", "spectacles", "eye care", "eyewear"], ["need glasses", "test my eyes", "poor eyesight", "get my eyes tested", "buy glasses"]),
  c("health_other", "health", "health and wellness", ["physiotherapist", "physiotherapy", "physio", "chiropractor", "occupational therapist", "psychologist", "counsellor", "counselor", "counselling", "counseling", "therapist", "mental health", "laboratory", "pathology", "medical lab", "herbalist", "traditional healer", "nanga", "midwife", "nutritionist", "dietitian", "wellness"], ["blood test", "talk to a counsellor", "need counselling", "back pain", "see a physio", "mental health support"]),
  c("vet", "health", "veterinary", ["vet", "veterinary", "veterinarian", "animal clinic", "animal hospital", "pet clinic", "pet shop", "pet store", "pet food", "dog grooming", "kennels", "animal health"], ["my dog is sick", "my cat is sick", "sick animal", "my cow is sick", "my goat is sick", "vaccinate my dog", "dog needs a vet"]),
  // Retail
  c("grocery", "retail", "grocery", ["grocery", "groceries", "grocer", "grocery store", "tuck shop", "tuckshop", "spaza", "convenience store", "corner shop", "general dealer", "butchery", "butcher", "greengrocer", "fresh produce", "green grocer", "fruit and veg"], ["buy groceries", "buy food", "where to buy meat", "buy vegetables", "buy fruit", "need groceries"]),
  c("supermarket", "retail", "supermarket", ["supermarket", "hypermarket", "cash and carry", "wholesaler", "wholesale", "bulk buying", "retail store"], ["bulk groceries", "buy in bulk", "buy wholesale"]),
  c("clothing", "retail", "clothing", ["clothing", "clothes", "clothing store", "boutique", "fashion", "fashion store", "apparel", "garments", "shoes", "shoe shop", "footwear", "menswear", "ladieswear", "kids clothing", "school uniform", "uniforms", "thrift", "second hand clothes", "bale"], ["buy clothes", "buy shoes", "where can i buy clothes", "buy a dress", "buy a suit", "buy school uniform"]),
  c("electronics", "retail", "electronics", ["electronics", "electronic store", "electronics shop", "cellphone shop", "cell phone shop", "phone shop", "mobile phone shop", "tv shop", "appliance store", "appliances", "electrical appliances", "computer shop", "laptops"], ["buy a phone", "buy a tv", "buy a laptop", "buy a fridge", "buy a cellphone", "buy a radio", "get a new phone"]),
  c("furniture", "retail", "furniture", ["furniture", "furniture store", "furniture shop", "furniture maker", "beds", "mattress", "mattresses", "couches", "sofas", "home furnishings", "upholstery", "upholsterer"], ["buy a bed", "buy a couch", "buy furniture", "buy a sofa", "buy a mattress", "need new furniture"]),
  c("hardware", "retail", "hardware", ["hardware", "hardware store", "hardware shop", "building materials", "building supplies", "timber", "paint shop", "cement", "plumbing supplies", "electrical supplies", "tools shop", "builders warehouse", "brick", "bricks"], ["buy cement", "buy paint", "buy tools", "buy bricks", "need bricks", "buy timber", "buy building materials"]),
  c("stationery", "retail", "stationery", ["stationery", "stationers", "bookshop", "book store", "bookstore", "books", "office supplies", "office furniture"], ["buy books", "buy a textbook", "buy stationery", "buy school books", "office supplies"]),
  c("liquor_store", "retail", "liquor store", ["bottle store", "liquor store", "liquor", "off licence", "wine shop", "bottle shop", "wine merchant"], ["buy beer", "buy wine", "buy alcohol", "buy a drink"]),
  // Education
  c("school", "education", "school", ["school", "primary school", "secondary school", "high school", "academy", "nursery school", "preschool", "pre school", "kindergarten", "boarding school", "private school"], ["school for my child", "school for my children", "enrol my child", "enroll my child", "find a school for my son", "find a school for my daughter", "school admissions"], ["driving school", "motoring school", "dance school", "music school", "flying school", "cooking school", "school uniform", "school books", "school bus", "school transport"]),
  c("tutor", "education", "tutor", ["tutor", "tutoring", "private tutor", "extra lessons", "private lessons", "home lessons", "maths lessons", "math lessons", "music lessons", "maths tutor", "math teacher", "maths teacher", "teacher", "coaching", "exam preparation"], ["help with maths", "help my child with maths", "my child needs help with maths", "homework help", "need a maths teacher", "extra help for my child", "o level help", "a level help", "learn maths", "learn english"], ["driving lessons", "driving lesson", "driving school", "driving instructor", "swimming lessons"]),
  c("college", "education", "college", ["college", "university", "polytechnic", "tertiary", "institute", "vocational", "technical college", "teachers college", "campus", "higher education", "business school"], ["study at university", "where to study", "apply to university", "get a degree", "get a diploma", "enrol at college", "enroll at college"], ["driving school"]),
  c("training_centre", "education", "training centre", ["training centre", "training center", "training institute", "training college", "skills training", "vocational training", "short courses", "computer training", "computer lessons", "computer courses", "secretarial college", "apprenticeship"], ["learn a skill", "learn computers", "learn to use a computer", "short course", "skills course", "learn welding", "learn sewing"]),
  c("childcare", "education", "childcare", ["childcare", "child care", "creche", "daycare", "day care", "day care centre", "nanny", "babysitter", "babysitting", "early childhood development", "ecd", "playgroup", "after care", "aftercare"], ["look after my child", "someone to look after my baby", "need a babysitter", "need a nanny", "somewhere to leave my child", "child minding"]),
  // Transport
  c("taxi", "transport", "taxi", ["taxi", "cab", "ride hailing", "ride sharing", "e hailing", "airport transfer", "airport shuttle", "shuttle", "kombi", "mushikashika", "chauffeur", "chauffeur service"], ["need a ride", "get a ride", "need a lift", "get to the airport", "transport to the airport", "need a taxi", "book a taxi", "get a cab", "pick me up"]),
  c("bus", "transport", "bus service", ["bus", "bus service", "bus company", "coach", "intercity bus", "long distance bus", "bus terminus", "bus station", "zupco", "omnibus", "luxury bus"], ["bus to", "travel by bus", "bus tickets", "bus ticket", "bus fare", "which bus", "bus times", "bus schedule"], ["school bus"]),
  c("logistics", "transport", "logistics and freight", ["logistics", "freight", "freight forwarding", "courier", "courier service", "cargo", "haulage", "trucking", "delivery service", "delivery services", "parcel", "parcels", "clearing agent", "shipping", "transport company", "removals", "removal", "movers", "moving company", "furniture removal", "bakkie for hire"], ["ship a parcel", "send a parcel", "send a package", "move house", "move my furniture", "need movers", "courier a parcel", "deliver a package", "send goods to", "transport goods"]),
  c("vehicle_transport", "transport", "vehicle transport", ["vehicle transport", "car carrier", "car transporter", "vehicle transporter", "vehicle delivery", "vehicle shipping", "car shipping"], ["ship my car", "transport my car", "move my car to", "transport my vehicle"]),
  // Professional services
  c("lawyer", "professional", "lawyer", ["lawyer", "attorney", "legal", "law firm", "legal services", "legal practitioner", "advocate", "conveyancer", "conveyancing", "notary", "commissioner of oaths"], ["need a lawyer", "legal advice", "legal help", "sue someone", "get a divorce", "draw up a will", "write a will", "contract dispute", "i need to go to court", "get a will"]),
  c("accountant", "professional", "accountant", ["accountant", "accounting", "accounting firm", "bookkeeper", "bookkeeping", "tax consultant", "tax services", "auditor", "payroll", "chartered accountant", "tax practitioner"], ["do my taxes", "tax returns", "file my tax", "do my books", "vat registration", "tax clearance", "register for tax", "audit my books"]),
  c("consultant", "professional", "consultant", ["consultant", "consulting", "consultancy", "business consultant", "management consultant", "advisory", "advisor", "adviser", "business advisor", "hr consulting", "marketing agency", "advertising agency", "architect", "quantity surveyor", "land surveyor", "engineering consultants"], ["business plan", "register a company", "company registration", "start a business", "need business advice", "draw house plans", "draw a building plan", "house plans"]),
  c("financial", "professional", "financial services", ["financial services", "bank", "banking", "insurance", "insurer", "insurance broker", "microfinance", "money lender", "loans", "loan", "savings", "investment", "investments", "financial advisor", "financial adviser", "money transfer", "forex", "bureau de change", "ecocash agent", "remittance", "pension", "funeral cover", "funeral policy"], ["get a loan", "borrow money", "send money", "exchange money", "change money", "open a bank account", "get insurance", "need funeral cover", "send money abroad", "receive money"]),
  c("printing", "professional", "printing", ["printing", "printers", "printing services", "print shop", "screen printing", "t shirt printing", "branding", "signage", "sign maker", "banners", "business cards", "flyers", "photocopying", "copy shop", "laminating", "stickers"], ["print my flyers", "print business cards", "print t shirts", "photocopy", "make banners", "make a banner", "print a poster"]),
  // Personal services
  c("barber", "personal", "barber", ["barber", "barbershop", "barber shop", "haircut", "hair cut", "gents salon", "mens haircut", "mens salon"], ["cut my hair", "need a haircut", "get a haircut", "trim my beard", "get a shave", "fade haircut"]),
  c("hair_salon", "personal", "hair salon", ["hair salon", "salon", "hairdresser", "hair dresser", "hair stylist", "hairstylist", "braiding", "plaiting", "weaves", "hair extensions", "wigs", "hair braiding", "dreadlocks", "natural hair", "ladies salon"], ["do my hair", "get my hair done", "braid my hair", "plait my hair", "install a weave", "need a haircut", "wash and set"]),
  c("beauty", "personal", "beauty services", ["beauty", "beauty salon", "beauty parlour", "beauty parlor", "nails", "nail salon", "nail technician", "manicure", "pedicure", "makeup", "make up artist", "makeup artist", "spa", "massage", "waxing", "facials", "skincare", "eyelashes", "lashes", "brows"], ["do my nails", "get my nails done", "get a massage", "do my makeup", "get waxed", "get a facial", "make me up for an event"]),
  c("tailor", "personal", "tailor", ["tailor", "tailoring", "seamstress", "dressmaker", "dressmaking", "alterations", "clothing alterations", "fashion designer", "fabric", "fabrics", "textiles", "embroidery", "sewing"], ["sew a dress", "make a dress", "alter my clothes", "fix my zip", "fix my trousers", "make me a suit", "get a suit made", "uniform made", "alter a dress"]),
  c("laundry", "personal", "laundry", ["laundry", "laundromat", "dry cleaner", "dry cleaning", "laundry services", "ironing", "washing services", "wash and iron"], ["wash my clothes", "wash my blankets", "iron my clothes", "dry clean my suit", "get my clothes washed"]),
  c("funeral", "personal", "funeral services", ["funeral parlour", "funeral parlor", "funeral home", "funeral services", "undertaker", "mortuary", "coffin", "coffins", "burial society", "burial services", "tombstone", "tombstones"], ["arrange a funeral", "someone has died", "bury a loved one", "need a coffin", "organise a burial"]),
  // Property
  c("estate_agent", "property", "estate agent", ["estate agent", "real estate", "realtor", "property agent", "property broker", "property sales", "houses for sale", "stands for sale", "property for sale", "land for sale", "real estate agency", "estate agency"], ["buy a house", "buy a stand", "buy land", "sell my house", "sell my stand", "looking for a stand", "house for sale", "property valuation", "value my house"]),
  c("property_rentals", "property", "rentals", ["rental", "rentals", "houses to rent", "flat to rent", "flats to rent", "apartments to rent", "rooms to rent", "cottage to rent", "room to rent", "house to rent", "property to let", "to let"], ["house to rent", "looking for a house to rent", "flat to rent", "room to rent", "rent a house", "rent a flat", "rent a room", "rent a cottage", "need a place to rent", "long term rental"]),
  c("property_management", "property", "property management", ["property management", "property manager", "facilities management", "body corporate", "landlord services", "rent collection"], ["manage my property", "manage my rentals", "manage my flats", "collect rent", "look after my property"]),
  // Technology
  c("computer_repair", "technology", "computer repair", ["computer repair", "laptop repair", "pc repair", "computer technician", "computer services", "laptop screen", "data recovery", "computer support", "desktop repair"], ["my laptop is broken", "laptop not working", "laptop wont start", "computer wont start", "laptop wont turn on", "fix my laptop", "fix my computer", "computer is slow", "virus on my computer", "reinstall windows", "laptop wont charge"]),
  c("phone_repair", "technology", "phone repair", ["phone repair", "cellphone repair", "cell phone repair", "mobile phone repair", "smartphone repair", "screen repair", "phone screen", "phone technician", "iphone repair", "samsung repair", "phone unlocking", "gsm repair"], ["my phone screen is cracked", "cracked screen", "broken screen", "phone wont charge", "phone wont switch on", "phone wont turn on", "fix my phone", "phone is broken", "water damaged phone", "my phone fell in water"]),
  c("it_support", "technology", "IT support", ["it support", "it services", "it consultant", "it company", "it solutions", "network installation", "networking", "web design", "web developer", "web development", "website design", "software developer", "software development", "app developer", "technology services", "managed services", "tech support", "computer networks"], ["build a website", "need a website", "make a website", "website for my business", "set up my network", "setup wifi at the office", "need an app", "it help"]),
  c("internet_services", "technology", "internet services", ["internet", "internet provider", "internet service provider", "isp", "wifi", "wi fi", "fibre", "fiber", "broadband", "starlink", "data provider", "telecoms", "telecommunications", "fibre installation", "wireless internet"], ["get internet", "need internet", "get wifi", "install wifi", "get fibre", "internet at home", "connect to the internet", "need data"]),
  // Events and recreation
  c("venue", "events", "venue", ["venue", "event venue", "hall", "function hall", "conference centre", "conference center", "conference room", "wedding venue", "banquet hall", "garden venue", "reception venue", "meeting room", "boardroom", "hall hire", "venue hire"], ["somewhere for my wedding", "venue for my wedding", "place for a function", "place for a party", "host a party", "host a wedding", "hall for a function", "where to hold an event", "book a venue", "hall for a party"]),
  c("event_services", "events", "event services", ["event planner", "event planning", "events", "event management", "event organiser", "event organizer", "wedding planner", "wedding", "dj", "mc", "event decor", "event decorator", "wedding decor", "decoration", "tent hire", "tents", "chair hire", "chairs and tables", "sound system", "sound hire", "pa system", "photographer", "photography", "videographer", "videography", "florist", "flowers", "party hire", "party planner", "bouncy castle", "entertainment hire"], ["plan my wedding", "organise a party", "organize a party", "need a dj", "need a photographer", "hire tents", "hire chairs", "tent for a wedding", "flowers for a wedding", "decorate for an event"]),
  c("gym", "events", "gym", ["gym", "fitness", "fitness centre", "fitness center", "health club", "personal trainer", "crossfit", "yoga", "pilates", "aerobics", "bodybuilding", "wellness centre", "boxing gym", "martial arts", "karate", "taekwondo"], ["work out", "get fit", "lose weight", "join a gym", "exercise place", "build muscle", "personal training", "place to exercise"]),
  c("sports_facility", "events", "sports facility", ["sports facility", "sports club", "sports centre", "sports center", "stadium", "soccer field", "football field", "football club", "golf course", "golf club", "tennis courts", "tennis club", "swimming pool", "swimming", "squash", "cricket club", "rugby club", "netball", "basketball court", "athletics", "sports ground", "playing field", "bowling"], ["play football", "play soccer", "play tennis", "play golf", "go swimming", "where can i swim", "place to play sport", "learn to swim"]),
  c("entertainment", "events", "entertainment", ["entertainment", "nightclub", "night club", "bar", "pub", "lounge", "cinema", "movie theatre", "theatre", "theater", "casino", "arcade", "bowling alley", "amusement park", "live music", "comedy", "karaoke", "cocktail bar", "sports bar", "tavern", "shebeen", "beer hall", "nightlife"], ["place to party", "go out tonight", "where to go out", "somewhere to have fun", "watch a movie", "things to do", "fun things to do", "go clubbing", "where can i have a drink", "have a drink"], ["football club", "golf club", "tennis club", "sports club", "cricket club", "rugby club"]),
  // Agriculture and industrial
  c("agriculture", "agriculture", "agriculture", ["farm", "farming", "farm supplies", "agricultural", "agriculture", "agri", "agro", "agro dealer", "agrodealer", "seed", "seeds", "fertiliser", "fertilizer", "stockfeed", "stock feed", "animal feed", "livestock", "irrigation", "tractor", "farm equipment", "poultry", "day old chicks", "cattle", "goats", "dairy", "crop", "grain", "maize", "milling", "grain milling", "hammer mill", "agricultural equipment"], ["buy seed", "buy fertiliser", "buy fertilizer", "buy chicks", "buy stockfeed", "buy animal feed", "irrigation system", "where to sell maize", "sell my maize", "sell my cattle", "buy cattle", "buy a tractor", "start a farm"]),
  c("industrial", "industrial", "industrial services", ["industrial", "manufacturing", "manufacturer", "factory", "engineering works", "engineering workshop", "machine shop", "machining", "metal works", "metalwork", "steel", "steelworks", "foundry", "industrial supplies", "industrial equipment", "industrial services", "scaffolding", "plant hire", "equipment hire", "crane hire", "earthmoving", "earth moving", "mining equipment", "mining services", "mine supplies", "chemicals", "packaging"], ["hire a crane", "hire equipment", "hire a digger", "need steel", "machine a part", "need packaging", "find a manufacturer", "hire a excavator"]),
  // Public, community and nonprofit
  c("government", "public", "government services", ["government office", "council", "city council", "town council", "municipality", "municipal", "ministry", "registrar", "registry", "registrar general", "civil registry", "births and deaths", "passport office", "immigration", "immigration office", "home affairs", "zimra", "revenue authority", "licensing", "vehicle inspectorate", "courts", "court", "magistrate court", "tax office", "labour office", "social welfare", "post office", "zimpost", "police", "police station", "fire brigade", "fire station", "public services", "government services"], ["get a passport", "renew my passport", "get a birth certificate", "birth certificate", "get an id", "get an id card", "national id", "replace my id", "get a death certificate", "marriage certificate", "register a birth", "report a crime", "lost my id", "apply for a passport", "pay my rates", "council rates", "apply for a licence"]),
  c("nonprofit", "public", "community and nonprofit", ["ngo", "non profit", "nonprofit", "non governmental", "charity", "community organisation", "community organization", "community centre", "community center", "community group", "community project", "foundation", "trust", "orphanage", "childrens home", "shelter", "food bank", "feeding scheme", "soup kitchen", "youth group", "support group", "volunteer", "volunteering", "community help", "humanitarian", "relief organisation"], ["where can i volunteer", "donate clothes", "donate food", "where to donate", "help for orphans", "free food", "food assistance", "help for the homeless", "i want to volunteer", "i want to donate"]),
  c("place_of_worship", "public", "place of worship", ["church", "fellowship", "assembly", "pentecostal", "apostolic", "anglican", "catholic", "methodist", "parish", "congregation", "place of worship", "worship centre", "worship center", "mosque", "temple", "synagogue", "chapel"], ["find a church", "place to worship", "somewhere to pray", "find a mosque", "church near me", "where can i pray", "where to worship"]),
];

/** A bare word like "school" can mean materially different things; these are asked about rather than guessed. */
const AMBIGUOUS_TERMS: Record<string, string[]> = {
  lessons: ["driving_school", "tutor"],
  lesson: ["driving_school", "tutor"],
  repair: ["mechanic", "appliance_repair", "phone_repair", "computer_repair"],
  repairs: ["mechanic", "appliance_repair", "phone_repair", "computer_repair"],
  fix: ["mechanic", "appliance_repair", "phone_repair", "computer_repair"],
  training: ["training_centre", "driving_school", "gym"],
  hire: ["vehicle_hire", "event_services", "industrial"],
  transport: ["taxi", "bus", "logistics"],
  delivery: ["takeaway", "logistics"],
  medical: ["clinic", "hospital", "pharmacy"],
  health: ["clinic", "hospital", "pharmacy", "health_other"],
  food: ["restaurant", "takeaway", "grocery"],
  rooms: ["accommodation", "property_rentals"],
  room: ["accommodation", "property_rentals"],
  hair: ["hair_salon", "barber"],
  haircut: ["barber", "hair_salon"],
  car: ["mechanic", "car_dealership", "vehicle_hire", "auto_parts"],
  cars: ["mechanic", "car_dealership", "vehicle_hire", "auto_parts"],
  phone: ["phone_repair", "electronics"],
  computer: ["computer_repair", "electronics", "it_support"],
};

export type ServiceIntent =
  | { kind: "concept"; concept: ServiceConcept; matched: string; via: "term" | "ask" }
  | { kind: "ambiguous"; options: ServiceConcept[]; question: string }
  | { kind: "unknown"; term: string };

const MAX_INPUT_CHARS = 300;
const FILLER = new Set(["i", "im", "need", "needs", "want", "wanna", "looking", "look", "for", "find", "me", "my", "please", "where", "can", "could", "get", "to", "is", "are", "there", "good", "best", "near", "nearby", "around", "here", "in", "at", "do", "you", "know", "anyone", "who", "someone", "somewhere", "a", "an", "the", "some", "any", "of", "with", "am", "have", "has", "it", "that", "this", "kind", "type", "sort", "services", "service", "what", "which", "recommend", "suggest", "show", "list", "local", "reliable", "cheap", "affordable", "and", "or", "us", "we", "our", "on", "up", "tell", "about", "searching", "search"]);

/** Lower-case, accent-free, apostrophes dropped, everything else collapsed to single spaces; bounded in length. */
export function normalizeServiceText(value: string | null | undefined): string {
  return (value ?? "").slice(0, MAX_INPUT_CHARS).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/['\u2018\u2019`]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Plural and common spelling variants of a normalised term. */
export function expandTerm(term: string): string[] {
  const variants = new Set([term]);
  if (term.endsWith("y") && !/[aeiou]y$/.test(term)) variants.add(`${term.slice(0, -1)}ies`);
  else if (/(?:ch|sh|x|s)$/.test(term)) { if (!term.endsWith("s")) variants.add(`${term}es`); }
  else variants.add(`${term}s`);
  if (term.endsWith("ies")) variants.add(`${term.slice(0, -3)}y`);
  else if (term.endsWith("s") && term.length > 3) variants.add(term.slice(0, -1));
  return [...variants];
}

interface IndexEntry { phrase: string; concept: ServiceConcept; via: "term" | "ask" }

export class ServiceTaxonomy {
  readonly concepts: ServiceConcept[];
  private readonly index: IndexEntry[];
  private readonly byId = new Map<string, ServiceConcept>();
  private readonly termCache = new Map<string, string[]>();

  constructor(concepts: ServiceConcept[] = SERVICE_CONCEPTS) {
    this.concepts = concepts;
    const index: IndexEntry[] = [];
    for (const concept of concepts) {
      this.byId.set(concept.id, concept);
      for (const term of concept.terms) for (const phrase of expandTerm(normalizeServiceText(term))) if (phrase) index.push({ phrase, concept, via: "term" });
      for (const ask of concept.asks) { const phrase = normalizeServiceText(ask); if (phrase) index.push({ phrase, concept, via: "ask" }); }
    }
    this.index = index.sort((left, right) => right.phrase.length - left.phrase.length);
  }

  concept(id: string | null | undefined): ServiceConcept | null { return id ? this.byId.get(id) ?? null : null; }

  /** A new, additional concept without touching the built-in list. */
  extend(extra: ServiceConcept[]): ServiceTaxonomy { return new ServiceTaxonomy([...this.concepts, ...extra]); }

  /** Interprets a service phrase or a short natural-language request. */
  resolve(input: string | null | undefined): ServiceIntent | null {
    const text = normalizeServiceText(input);
    if (!text) return null;
    const content = text.split(" ").filter((word) => !FILLER.has(word));
    const bare = content.join(" ");
    const ambiguous = AMBIGUOUS_TERMS[bare];
    if (ambiguous?.length) {
      const options = ambiguous.map((id) => this.byId.get(id)).filter((item): item is ServiceConcept => !!item);
      if (options.length > 1) return { kind: "ambiguous", options, question: ambiguityQuestion(options) };
    }
    const padded = ` ${text} `;
    let best = 0;
    const hits = new Map<string, IndexEntry>();
    for (const entry of this.index) {
      if (entry.phrase.length < best) break;
      if (!padded.includes(` ${entry.phrase} `)) continue;
      best = entry.phrase.length;
      if (!hits.has(entry.concept.id)) hits.set(entry.concept.id, entry);
    }
    const found = [...hits.values()];
    if (found.length > 1) {
      const options = found.map((entry) => entry.concept);
      return { kind: "ambiguous", options, question: ambiguityQuestion(options) };
    }
    if (found.length === 1) return { kind: "concept", concept: found[0].concept, matched: found[0].phrase, via: found[0].via };
    return content.length ? { kind: "unknown", term: bare } : null;
  }

  /** Normalised phrases that identify the concept in a business name, category or description. */
  searchTerms(concept: ServiceConcept): string[] {
    const cached = this.termCache.get(concept.id);
    if (cached) return cached;
    const terms = [...new Set(concept.terms.flatMap((term) => expandTerm(normalizeServiceText(term))))].filter(Boolean);
    this.termCache.set(concept.id, terms);
    return terms;
  }
}

function ambiguityQuestion(options: ServiceConcept[]): string {
  const labels = options.slice(0, 4).map((option) => option.label);
  const list = labels.length > 2 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels.join(" or ");
  return `Just so I search the right thing: do you mean ${list}?`;
}

export const SERVICE_TAXONOMY = new ServiceTaxonomy();

/** True only when the message is mainly about one service (not a passing mention inside a longer sentence). */
export function isFocusedServiceRequest(input: string, matched: string, via: "term" | "ask"): boolean {
  if (via === "ask") return true;
  const content = normalizeServiceText(input).split(" ").filter((word) => !FILLER.has(word));
  const covered = new Set(matched.split(" "));
  const own = content.filter((word) => covered.has(word)).length;
  return content.length > 0 && own / content.length > 0.5;
}

export interface MatchableRecord { name?: string | null; category?: string | null; subcategory?: string | null; tags?: string[] | null; description?: string | null }
export interface ServiceMatchIntent { terms: string[]; excludes: string[] }

/** The search intent for a request: canonical terms when the taxonomy knows the service, otherwise the user's own words. */
export function serviceMatchIntent(category: string | null | undefined, serviceConcept?: string | null, taxonomy: ServiceTaxonomy = SERVICE_TAXONOMY): ServiceMatchIntent | null {
  const concept = taxonomy.concept(serviceConcept);
  if (concept) return { terms: taxonomy.searchTerms(concept), excludes: concept.excludes.map(normalizeServiceText) };
  const text = normalizeServiceText(category);
  if (!text) return null;
  const intent = taxonomy.resolve(text);
  if (intent?.kind === "concept") return { terms: taxonomy.searchTerms(intent.concept), excludes: intent.concept.excludes.map(normalizeServiceText) };
  if (intent?.kind === "ambiguous") return { terms: [...new Set(intent.options.flatMap((option) => taxonomy.searchTerms(option)))], excludes: [] };
  return { terms: expandTerm(text), excludes: [] };
}

const hasPhrase = (haystack: string, term: string) => haystack.length > 0 && ` ${haystack} `.includes(` ${term} `);

/** 100 name, 70 category, 60 subcategory, 50 tags, 30 description; 0 when nothing relevant. Never a verification signal. */
export function scoreServiceMatch(intent: ServiceMatchIntent, record: MatchableRecord): number {
  const fields: [string | null | undefined, number][] = [[record.name, 100], [record.category, 70], [record.subcategory, 60], [record.tags?.join(" "), 50], [record.description, 30]];
  let best = 0;
  for (const [value, weight] of fields) {
    const text = normalizeServiceText(value);
    if (!text || weight <= best) continue;
    if (intent.excludes.some((exclude) => exclude && hasPhrase(text, exclude))) continue;
    if (intent.terms.some((term) => hasPhrase(text, term))) best = weight;
  }
  return best;
}

/**
 * Terms for a database `ilike` narrowing filter. Longer terms that merely contain a shorter kept term are
 * dropped because a substring match already covers them. Terms under four letters are returned separately
 * so the caller can match them as whole words instead of substrings.
 */
export function databaseFilterTerms(intent: ServiceMatchIntent, limit = 24): { substrings: string[]; words: string[] } {
  const usable = [...new Set(intent.terms.filter((term) => /^[\p{L}\p{N} ]{2,40}$/u.test(term)))].sort((left, right) => left.length - right.length);
  const substrings: string[] = [];
  const words: string[] = [];
  for (const term of usable) {
    if (term.length < 4) { if (!words.includes(term)) words.push(term); continue; }
    if (!substrings.some((kept) => term.includes(kept))) substrings.push(term);
  }
  return { substrings: substrings.slice(0, limit), words: words.slice(0, 8) };
}
