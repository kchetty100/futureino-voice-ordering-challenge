import { CATALOG, getItem, itemsForMachine, type CatalogItem, type MachineId, type TasteTag, type Temperature } from "../catalog/index";

/**
 * A vague taste or recommendation question: "something sweet but not too heavy?",
 * "not too heavy", "what do you recommend?". Answered from this machine's taste tags only.
 */
export type Preference = {
  /** Taste tags the customer asked for. */
  want: TasteTag[];
  /** Taste tags the customer ruled out ("not too sweet"). */
  avoid: TasteTag[];
  /** "Light", "not too heavy", "refreshing": skip rich items and lead with the lightest. */
  light: boolean;
  /** "What do you recommend?" with no taste words. */
  recommend: boolean;
  /** "Something hot", "warm and cozy", "something iced": a serving temperature, not a taste. */
  temperature: Temperature | null;
  /** They ruled out something we have no data on ("without milk"). Answer with "no ingredient details". */
  ingredient: boolean;
};

/** Spoken word → serving temperature. These count as preference words, so "what's nice that's hot?" is a preference. */
const TEMPERATURE_WORDS: Record<string, Temperature> = {
  hot: "hot", warm: "hot", warming: "hot", warmer: "hot", cozy: "hot", cosy: "hot", toasty: "hot", steaming: "hot",
  caliente: "hot", calentito: "hot", chaud: "hot", chaude: "hot", "חם": "hot", "חמה": "hot",
  iced: "iced", ice: "iced", icy: "iced", cold: "iced", chilled: "iced", cool: "iced", colder: "iced",
  "frío": "iced", "fría": "iced", frio: "iced", fria: "iced", helado: "iced", helada: "iced", "glacé": "iced", "glacée": "iced",
  froid: "iced", froide: "iced", frais: "iced", "fraîche": "iced", koud: "iced", koue: "iced", ys: "iced", "קר": "iced", "קרה": "iced",
};

/** Taste tags that make a drink feel right at a temperature, for ordering a bare "something hot". */
const FEELS: Record<Temperature, readonly TasteTag[]> = {
  hot: ["creamy", "spiced", "chocolate", "rich"],
  iced: ["fruity", "tart", "light"],
  room: ["fruity", "light"],
};

/** "I'm freezing", "cold outside": the customer wants something warm. "Boiling", "hot out": something cold. */
function weatherToTemperature(text: string): string {
  return text
    .replace(/\b(?:i'?m|im|i am|it'?s|its|so|really)\s+(?:so\s+|really\s+)?(?:freezing|chilly|cold|frozen)\b/g, " cozy ")
    .replace(/\b(?:freezing|chilly|cold)\s+(?:outside|out|today|morning|day|weather)\b/g, " cozy ")
    .replace(/\b(?:i'?m|im|i am|it'?s|its|so|really)\s+(?:so\s+|really\s+)?(?:boiling|sweating|roasting|baking)\b/g, " chilled ")
    .replace(/\b(?:hot|boiling|warm)\s+(?:outside|out|today|day|weather)\b/g, " chilled ");
}

/** Spoken word → catalog taste tag. "heavy" means rich. "light" is handled on its own. */
const TASTE_WORDS: Record<string, TasteTag | "light" | "heavy"> = {
  sweet: "sweet", sweets: "sweet", sweeter: "sweet", sugary: "sweet", sugar: "sweet", dessert: "sweet", treat: "sweet",
  dulce: "sweet", "sucré": "sweet", sucre: "sweet", "sucrée": "sweet", soet: "sweet", "מתוק": "sweet",
  salty: "salty", salted: "salty", salado: "salty", "salé": "salty", sout: "salty", "מלוח": "salty",
  savory: "savory", savoury: "savory",
  chocolate: "chocolate", chocolatey: "chocolate", chocolaty: "chocolate", chocolat: "chocolate", sjokolade: "chocolate",
  crunchy: "crunchy", crunch: "crunchy", crispy: "crispy", crisp: "crispy",
  chewy: "chewy", nutty: "nutty",
  fruity: "fruity", fruit: "fruity", fruits: "fruity", afrutado: "fruity", "fruité": "fruity",
  creamy: "creamy", spiced: "spiced", spicy: "spicy",
  mild: "mild", smooth: "mild", strong: "strong", bold: "strong", bitter: "bitter", plain: "plain",
  tart: "tart", sour: "tart", tangy: "tart", zesty: "tart",
  rich: "rich", indulgent: "rich", filling: "rich",
  light: "light", lighter: "light", refreshing: "light", ligero: "light", ligera: "light", "léger": "light",
  "légère": "light", leger: "light", lig: "light", ligte: "light", "קליל": "light",
  heavy: "heavy", pesado: "heavy", lourd: "heavy", swaar: "heavy", "כבד": "heavy",
};

/** Ingredients customers rule out. We have no ingredient data for any item. */
const INGREDIENTS = new Set([
  "milk", "dairy", "lactose", "cream", "sugar", "nuts", "nut", "peanuts", "gluten", "wheat", "soy", "caffeine", "egg", "eggs",
  "leche", "lait", "melk", "חלב", "azúcar", "azucar", "suiker", "סוכר", "cafeína", "caféine", "kafeïen", "קפאין",
]);

const NEGATORS = new Set(["not", "no", "nothing", "without", "less", "isnt", "non", "sin", "sans", "pas", "nie", "sonder", "לא", "בלי"]);

/** Words between a negator and the taste word: "not TOO heavy", "pas trop lourd". */
const SOFTENERS = new Set(["too", "very", "so", "overly", "really", "super", "that", "a", "bit", "as", "trop", "muy", "demasiado", "te", "baie", "מדי", "יותר"]);

/** Words that make a preference sentence and nothing else. Any other word sends it to normal search. */
const FILLER = new Set([
  "something", "anything", "some", "any", "a", "an", "the", "i", "id", "im", "ill", "want", "wanna", "would", "like", "love",
  "need", "please", "can", "could", "get", "have", "give", "me", "you", "your", "got", "do", "does", "is", "are", "with",
  "but", "and", "or", "kind", "kinda", "sort", "of", "that", "thats", "which", "what", "whats", "for", "to", "maybe", "um",
  "uh", "just", "quite", "more", "little", "bit", "snack", "snacks", "drink", "drinks", "coffee", "coffees", "option",
  "options", "today", "here", "it", "on", "this", "machine", "in", "mood", "feel", "feeling", "craving", "after", "looking",
  "hmm", "ok", "okay", "so", "well", "one", "should", "try", "good", "nice", "there", "be", "will", "we", "us", "my",
  "else", "really", "very", "too", "not", "no", "nothing", "without", "less", "from", "at", "eat", "bot", "up", "cup",
  "hows", "how", "about", "tea", "go", "when", "outside", "weather", "day", "morning", "its", "lekker", "rico", "bon", "bueno", "buena",
  // Short words in the other kiosk languages, so "algo dulce" or "iets soet" still reads as a preference.
  "algo", "quelque", "chose", "iets", "משהו", "que", "qué", "quoi", "wat", "puedes", "pouvez", "vous", "tu", "usted", "jy",
  "u", "de", "un", "una", "une", "pero", "mais", "maar", "אבל", "מה", "אתה", "pas", "trop", "muy", "nie", "te", "baie",
  "sin", "sans", "sonder", "לא", "בלי", "demasiado", "מדי",
]);

/** Multi-word recommendation asks, in English. */
const RECOMMEND_PHRASE =
  /\b(surprise me|what'?s good|what is good|what should i (?:get|have|try|order)|don'?t know what|not sure what|anything good|something good)\b/i;

/** One-word recommendation asks. Token match, so accented and Hebrew words work. */
const RECOMMEND_WORDS = new Set([
  "recommend", "recommends", "recommended", "recommendation", "recommendations", "suggest", "suggestion", "suggestions",
  "popular", "favorite", "favourite", "favorites", "favourites", "best",
  "recomienda", "recomiende", "recomiendas", "recomendación", "recomendacion", "recommandez", "recommandes", "recommande",
  "recommandation", "aanbeveel", "beveel", "aanbeveling", "ממליץ", "תמליץ", "המלצה", "מומלץ",
]);

/** Words that belong to a recommendation phrase, not to a product. */
const RECOMMEND_FILLER = new Set(["surprise", "know", "dont", "sure", "whats", "should", "order", "try", "good"]);

/** Real catalog ids shown for a bare "what do you recommend?". A spread of tastes, not a sales claim. */
const PICKS: Record<MachineId, readonly string[]> = {
  coffee: ["coffee-04", "coffee-03", "coffee-10"],
  snacks: ["snacks-19", "snacks-11", "snacks-09"],
};

for (const [machineId, ids] of Object.entries(PICKS)) {
  for (const id of ids) {
    if (getItem(id)?.machineId !== machineId) throw new Error(`Recommendation is not on ${machineId}: ${id}`);
  }
}

/** Null when the sentence is not only a taste or recommendation question. */
export function parsePreference(text: string): Preference | null {
  const lowered = weatherToTemperature(text.toLowerCase().replace(/’/g, "'")).replace(/'/g, "");
  const tokens = lowered.split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 0);
  const recommend = RECOMMEND_PHRASE.test(text.replace(/’/g, "'")) || tokens.some((token) => RECOMMEND_WORDS.has(token));
  if (tokens.length === 0 || tokens.length > 14) return null;

  const want = new Set<TasteTag>();
  const avoid = new Set<TasteTag>();
  let light = false;
  let temperature: Temperature | null = null;
  /** "Without milk": something we have no tag for. We cannot promise it, so we say so. */
  let ingredient = false;
  let namedIngredient = false;
  let tasteWords = 0;
  let leftovers = 0;
  let negated = false;
  let gap = 0;

  for (const token of tokens) {
    const temp = TEMPERATURE_WORDS[token];
    if (temp) {
      tasteWords += 1;
      if (!negated) temperature = temp;
      negated = false;
      continue;
    }
    const taste = TASTE_WORDS[token];
    if (taste) {
      tasteWords += 1;
      if (negated) {
        if (taste === "heavy" || taste === "rich") light = true;
        else if (taste !== "light") avoid.add(taste);
      } else if (taste === "light") light = true;
      else if (taste === "heavy") want.add("rich");
      else want.add(taste);
      negated = false;
      continue;
    }
    if (NEGATORS.has(token)) {
      negated = true;
      gap = 0;
      continue;
    }
    if (negated && (SOFTENERS.has(token) || FILLER.has(token)) && gap < 3) {
      gap += 1;
      continue;
    }
    if (negated && !RECOMMEND_WORDS.has(token)) {
      ingredient = true;
      if (INGREDIENTS.has(token)) namedIngredient = true;
      negated = false;
      continue;
    }
    negated = false;
    if (FILLER.has(token)) continue;
    if (RECOMMEND_WORDS.has(token) || (recommend && RECOMMEND_FILLER.has(token))) continue;
    leftovers += 1;
  }

  if (leftovers > 0) return null;
  // "No milk please" on its own is still an ingredient question; "no thanks" is not.
  if (tasteWords === 0 && !recommend && !namedIngredient) return null;
  for (const tag of avoid) want.delete(tag);
  if (light) want.delete("rich");
  return {
    want: [...want],
    avoid: [...avoid],
    light,
    recommend: recommend && want.size === 0 && avoid.size === 0 && !light && !temperature,
    temperature,
    ingredient,
  };
}

/** Real items on this machine for a preference. Empty means nothing here fits the taste words. */
export function preferredItems(machineId: MachineId, preference: Preference, limit = 3): CatalogItem[] {
  const servesDrinks = itemsForMachine(machineId).some((item) => item.requiresTemperature);
  if (preference.temperature && !servesDrinks) {
    // Snacks: "something hot" means spicy. Nothing on the snack machine is served cold.
    if (preference.temperature !== "hot") return [];
    preference = { ...preference, temperature: null, want: [...new Set<TasteTag>([...preference.want, "spicy"])] };
  }
  if (preference.recommend) {
    return PICKS[machineId].flatMap((id) => {
      const item = getItem(id);
      return item ? [item] : [];
    }).slice(0, limit);
  }
  const order = new Map(CATALOG.map((item, index) => [item.id, index]));
  // Hidden-contents items carry no taste tags, so they are never suggested for a taste.
  const temperature = preference.temperature;
  let pool = itemsForMachine(machineId).filter(
    (item) =>
      item.tasteTags.length > 0 &&
      !preference.avoid.some((tag) => item.tasteTags.includes(tag)) &&
      (!temperature || (item.suits ?? []).includes(temperature)),
  );
  if (preference.light) {
    const notRich = pool.filter((item) => !item.tasteTags.includes("rich"));
    if (notRich.length > 0) pool = notRich;
  }
  const want = preference.want;
  const matched = want.length > 0 ? pool.filter((item) => want.some((tag) => item.tasteTags.includes(tag))) : pool;
  return matched
    .map((item) => ({
      item,
      hits: want.filter((tag) => item.tasteTags.includes(tag)).length,
      // Best served at the asked temperature first, then the drinks that feel most like it.
      primary: temperature && item.suits?.[0] === temperature ? 1 : 0,
      feel: temperature ? FEELS[temperature].filter((tag) => item.tasteTags.includes(tag)).length : 0,
      weight: preference.light ? heaviness(item) : 0,
    }))
    .sort(
      (a, b) =>
        b.hits - a.hits ||
        b.primary - a.primary ||
        b.feel - a.feel ||
        a.weight - b.weight ||
        (order.get(a.item.id) ?? 0) - (order.get(b.item.id) ?? 0),
    )
    .slice(0, limit)
    .map((row) => row.item);
}

/** Lower is lighter, from taste tags only. No calories are claimed. */
function heaviness(item: CatalogItem): number {
  const tags = item.tasteTags;
  let weight = 0;
  if (tags.includes("rich")) weight += 2;
  if (tags.includes("creamy")) weight += 1;
  if (tags.includes("chocolate")) weight += 1;
  if (tags.includes("light")) weight -= 2;
  if (tags.includes("fruity")) weight -= 1;
  if (tags.includes("tart")) weight -= 1;
  return weight;
}

/** "A latte without milk": an ingredient ruled out next to a product. We cannot check or change recipes. */
export function rulesOutIngredient(text: string): boolean {
  const tokens = text.toLowerCase().replace(/['’]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return tokens.some((token, index) => {
    if (!INGREDIENTS.has(token)) return false;
    const before = tokens.slice(Math.max(0, index - 3), index);
    return before.some((word) => NEGATORS.has(word) || word === "free");
  }) || /\b(dairy|lactose|sugar|gluten|nut|caffeine)[- ]free\b/i.test(text);
}
