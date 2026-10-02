import type { AppLanguage } from "./types";

export type PhraseKey =
  | "choose_machine"
  | "view_items"
  | "didnt_catch"
  | "cart_cleared"
  | "cart_empty"
  | "heres_cart"
  | "scroll_up"
  | "scroll_down"
  | "going_back"
  | "open_menu_first"
  | "ready_to_pay"
  | "already_ready"
  | "stale_yes"
  | "need_readback"
  | "okay_change"
  | "what_else"
  | "allergens_unknown"
  | "say_one_temp"
  | "choose_temp"
  | "add_or_confirm"
  | "not_carried"
  | "can_offer"
  | "needs_temp"
  | "need_temps"
  | "removed"
  | "temp_saved"
  | "added"
  | "added_need_temp"
  | "read_back"
  | "that_item"
  | "which_item"
  | "not_in_order"
  | "language_set"
  | "only_menu_tools"
  | "session_abandoned"
  | "unknown_product"
  | "wrong_machine"
  | "invalid_quantity"
  | "invalid_temperature"
  | "temperature_not_allowed"
  | "unknown_line"
  | "incomplete"
  | "not_awaiting_confirmation"
  | "stale_cart"
  | "walked_away"
  | "still_there"
  | "order_ends_in"
  | "welcome_choose";

type Params = Record<string, string | number | undefined>;

const EN: Record<PhraseKey, string> = {
  choose_machine: "Boost Coffee or Snacks Bot?",
  view_items: "Please view the items below.",
  didnt_catch: "I didn't catch that.",
  cart_cleared: "Cart cleared.",
  cart_empty: "The cart is empty.",
  heres_cart: "Here's your cart.",
  scroll_up: "Scrolling up.",
  scroll_down: "Scrolling down.",
  going_back: "Going back.",
  open_menu_first: "Open a menu first.",
  ready_to_pay: "Ready to pay {total}.",
  already_ready: "This order is already ready to pay.",
  stale_yes: "That yes was for an older cart. Ask me to read the order again.",
  need_readback: "I need to read the order back before a yes counts.",
  okay_change: "Okay. What do you want to change?",
  what_else: "What else would you like?",
  allergens_unknown: "I don't have allergen information. Nothing on this machine has an ingredient list.",
  say_one_temp: "Say one: hot, iced, or room.",
  choose_temp: "Choose hot, iced, or room.",
  add_or_confirm: "Add another item, or say yes to confirm.",
  not_carried: "This machine doesn't carry that.",
  can_offer: "I can offer {names}.",
  needs_temp: "{name} still needs a temperature. Hot, iced, or room?",
  need_temps: "{names} still need a temperature. Hot, iced, or room?",
  removed: "Removed.",
  temp_saved: "Temperature saved.",
  added: "Added {temp}{name}.",
  added_need_temp: "{name} is in the cart. Hot, iced, or room?",
  read_back: "That's {lines}. Total {total}. Would you like to add anything else, or say yes to confirm the order?",
  that_item: "That item",
  which_item: "Which item? {names}.",
  not_in_order: "That isn't in this order.",
  language_set: "Okay, I'll speak {language}.",
  only_menu_tools: "I can only search this machine, add a menu item, or read the order back.",
  session_abandoned: "This order was cleared.",
  unknown_product: "That item is not on this machine.",
  wrong_machine: "That item is not on this machine.",
  invalid_quantity: "I can add between 1 and 9.",
  invalid_temperature: "Choose hot, iced, or room.",
  temperature_not_allowed: "Snacks do not take a temperature.",
  unknown_line: "That line is no longer in the cart.",
  incomplete: "Choose hot, iced, or room before I can confirm.",
  not_awaiting_confirmation: "I need to read the order back before a yes counts.",
  stale_cart: "That order changed. Ask me to read it again.",
  walked_away: "The customer walked away. The cart was cleared.",
  still_there: "Still there?",
  order_ends_in: "No one in front. This order ends in {time}.",
  welcome_choose: "Welcome. Please make a selection from below.",
};

const ES: Record<PhraseKey, string> = {
  choose_machine: "¿Boost Coffee o Snacks Bot?",
  view_items: "Mira los productos abajo.",
  didnt_catch: "No te escuché.",
  cart_cleared: "Carrito vacío.",
  cart_empty: "El carrito está vacío.",
  heres_cart: "Aquí está tu carrito.",
  scroll_up: "Subiendo.",
  scroll_down: "Bajando.",
  going_back: "Volviendo atrás.",
  open_menu_first: "Abre un menú primero.",
  ready_to_pay: "Listo para pagar {total}.",
  already_ready: "Este pedido ya está listo para pagar.",
  stale_yes: "Ese sí era de un carrito anterior. Pídeme que lea el pedido otra vez.",
  need_readback: "Necesito leer el pedido antes de que un sí cuente.",
  okay_change: "De acuerdo. ¿Qué quieres cambiar?",
  what_else: "¿Qué más te gustaría?",
  allergens_unknown: "No tengo información de alérgenos. Nada en esta máquina tiene lista de ingredientes.",
  say_one_temp: "Di una: caliente, con hielo, o al ambiente.",
  choose_temp: "Elige caliente, con hielo, o al ambiente.",
  add_or_confirm: "Añade otro producto, o di sí para confirmar.",
  not_carried: "Esta máquina no tiene eso.",
  can_offer: "Puedo ofrecer {names}.",
  needs_temp: "{name} aún necesita temperatura. ¿Caliente, con hielo, o al ambiente?",
  need_temps: "{names} aún necesitan temperatura. ¿Caliente, con hielo, o al ambiente?",
  removed: "Eliminado.",
  temp_saved: "Temperatura guardada.",
  added: "Añadí {temp}{name}.",
  added_need_temp: "{name} está en el carrito. ¿Caliente, con hielo, o al ambiente?",
  read_back: "Son {lines}. Total {total}. ¿Quieres añadir algo más, o di sí para confirmar el pedido?",
  that_item: "Ese producto",
  which_item: "¿Cuál? {names}.",
  not_in_order: "Eso no está en este pedido.",
  language_set: "De acuerdo, hablaré en {language}.",
  only_menu_tools: "Solo puedo buscar en esta máquina, añadir un producto del menú, o leer el pedido.",
  session_abandoned: "Este pedido se canceló.",
  unknown_product: "Ese producto no está en esta máquina.",
  wrong_machine: "Ese producto no está en esta máquina.",
  invalid_quantity: "Puedo añadir entre 1 y 9.",
  invalid_temperature: "Elige caliente, con hielo, o al ambiente.",
  temperature_not_allowed: "Los snacks no llevan temperatura.",
  unknown_line: "Esa línea ya no está en el carrito.",
  incomplete: "Elige caliente, con hielo, o al ambiente antes de confirmar.",
  not_awaiting_confirmation: "Necesito leer el pedido antes de que un sí cuente.",
  stale_cart: "Ese pedido cambió. Pídeme que lo lea otra vez.",
  walked_away: "El cliente se fue. Se vació el carrito.",
  still_there: "¿Sigues ahí?",
  order_ends_in: "No hay nadie delante. Este pedido termina en {time}.",
  welcome_choose: "Bienvenido. Elige una opción de abajo.",
};

const FR: Record<PhraseKey, string> = {
  choose_machine: "Boost Coffee ou Snacks Bot ?",
  view_items: "Regardez les articles ci-dessous.",
  didnt_catch: "Je n'ai pas compris.",
  cart_cleared: "Panier vidé.",
  cart_empty: "Le panier est vide.",
  heres_cart: "Voici votre panier.",
  scroll_up: "Je remonte.",
  scroll_down: "Je descends.",
  going_back: "Je reviens en arrière.",
  open_menu_first: "Ouvrez d'abord un menu.",
  ready_to_pay: "Prêt à payer {total}.",
  already_ready: "Cette commande est déjà prête à payer.",
  stale_yes: "Ce oui concernait un ancien panier. Demandez-moi de relire la commande.",
  need_readback: "Je dois relire la commande avant qu'un oui compte.",
  okay_change: "D'accord. Que voulez-vous changer ?",
  what_else: "Que voulez-vous d'autre ?",
  allergens_unknown: "Je n'ai pas d'informations sur les allergènes. Rien sur cette machine n'a de liste d'ingrédients.",
  say_one_temp: "Dites une : chaud, glacé, ou ambiant.",
  choose_temp: "Choisissez chaud, glacé, ou ambiant.",
  add_or_confirm: "Ajoutez un autre article, ou dites oui pour confirmer.",
  not_carried: "Cette machine n'a pas ça.",
  can_offer: "Je peux proposer {names}.",
  needs_temp: "{name} a encore besoin d'une température. Chaud, glacé, ou ambiant ?",
  need_temps: "{names} ont encore besoin d'une température. Chaud, glacé, ou ambiant ?",
  removed: "Retiré.",
  temp_saved: "Température enregistrée.",
  added: "Ajouté : {temp}{name}.",
  added_need_temp: "{name} est dans le panier. Chaud, glacé, ou ambiant ?",
  read_back: "Voilà {lines}. Total {total}. Voulez-vous ajouter autre chose, ou dites oui pour confirmer ?",
  that_item: "Cet article",
  which_item: "Lequel ? {names}.",
  not_in_order: "Ce n'est pas dans cette commande.",
  language_set: "D'accord, je parlerai en {language}.",
  only_menu_tools: "Je peux seulement chercher sur cette machine, ajouter un article du menu, ou relire la commande.",
  session_abandoned: "Cette commande a été annulée.",
  unknown_product: "Cet article n'est pas sur cette machine.",
  wrong_machine: "Cet article n'est pas sur cette machine.",
  invalid_quantity: "Je peux ajouter entre 1 et 9.",
  invalid_temperature: "Choisissez chaud, glacé, ou ambiant.",
  temperature_not_allowed: "Les snacks n'ont pas de température.",
  unknown_line: "Cette ligne n'est plus dans le panier.",
  incomplete: "Choisissez chaud, glacé, ou ambiant avant de confirmer.",
  not_awaiting_confirmation: "Je dois relire la commande avant qu'un oui compte.",
  stale_cart: "Cette commande a changé. Demandez-moi de la relire.",
  walked_away: "Le client est parti. Le panier a été vidé.",
  still_there: "Toujours là ?",
  order_ends_in: "Personne devant la machine. Cette commande se termine dans {time}.",
  welcome_choose: "Bienvenue. Faites un choix parmi les options ci-dessous.",
};

const HE: Record<PhraseKey, string> = {
  choose_machine: "Boost Coffee או Snacks Bot?",
  view_items: "אפשר לראות את המוצרים למטה.",
  didnt_catch: "לא שמעתי.",
  cart_cleared: "העגלה רוקנה.",
  cart_empty: "העגלה ריקה.",
  heres_cart: "הנה העגלה שלך.",
  scroll_up: "גולל למעלה.",
  scroll_down: "גולל למטה.",
  going_back: "חוזר אחורה.",
  open_menu_first: "קודם תפתח תפריט.",
  ready_to_pay: "מוכן לתשלום {total}.",
  already_ready: "ההזמנה כבר מוכנה לתשלום.",
  stale_yes: "האישור היה לעגלה ישנה. בקש ממני לקרוא שוב את ההזמנה.",
  need_readback: "אני צריך לקרוא את ההזמנה לפני שאישור נספר.",
  okay_change: "בסדר. מה לשנות?",
  what_else: "מה עוד תרצה?",
  allergens_unknown: "אין לי מידע על אלרגנים. לשום מוצר במכונה אין רשימת רכיבים.",
  say_one_temp: "תגיד אחת: חם, עם קרח, או בטמפרטורת החדר.",
  choose_temp: "בחר חם, עם קרח, או בטמפרטורת החדר.",
  add_or_confirm: "הוסף עוד מוצר, או תגיד כן כדי לאשר.",
  not_carried: "המכונה לא מוכרת את זה.",
  can_offer: "אני יכול להציע {names}.",
  needs_temp: "ל־{name} עדיין חסרה טמפרטורה. חם, עם קרח, או בטמפרטורת החדר?",
  need_temps: "ל־{names} עדיין חסרה טמפרטורה. חם, עם קרח, או בטמפרטורת החדר?",
  removed: "הוסר.",
  temp_saved: "הטמפרטורה נשמרה.",
  added: "נוסף {temp}{name}.",
  added_need_temp: "{name} בעגלה. חם, עם קרח, או בטמפרטורת החדר?",
  read_back: "זה {lines}. סה״כ {total}. רוצה להוסיף משהו, או תגיד כן כדי לאשר?",
  that_item: "המוצר הזה",
  which_item: "איזה מוצר? {names}.",
  not_in_order: "זה לא בהזמנה הזו.",
  language_set: "בסדר, אדבר ב{language}.",
  only_menu_tools: "אני יכול רק לחפש במכונה, להוסיף מוצר מהתפריט, או לקרוא את ההזמנה.",
  session_abandoned: "ההזמנה בוטלה.",
  unknown_product: "המוצר הזה לא במכונה.",
  wrong_machine: "המוצר הזה לא במכונה.",
  invalid_quantity: "אפשר להוסיף בין 1 ל־9.",
  invalid_temperature: "בחר חם, עם קרח, או בטמפרטורת החדר.",
  temperature_not_allowed: "לחטיפים אין טמפרטורה.",
  unknown_line: "השורה הזו כבר לא בעגלה.",
  incomplete: "בחר חם, עם קרח, או בטמפרטורת החדר לפני אישור.",
  not_awaiting_confirmation: "אני צריך לקרוא את ההזמנה לפני שאישור נספר.",
  stale_cart: "ההזמנה השתנתה. בקש ממני לקרוא אותה שוב.",
  walked_away: "הלקוח הלך. העגלה רוקנה.",
  still_there: "עדיין כאן?",
  order_ends_in: "אין אף אחד מול המכונה. ההזמנה תסתיים בעוד {time}.",
  welcome_choose: "ברוכים הבאים. בחרו מאפשרויות למטה.",
};

const AF: Record<PhraseKey, string> = {
  choose_machine: "Boost Coffee of Snacks Bot?",
  view_items: "Kyk asseblief na die items hieronder.",
  didnt_catch: "Ek het dit nie gehoor nie.",
  cart_cleared: "Mandjie skoongemaak.",
  cart_empty: "Die mandjie is leeg.",
  heres_cart: "Hier is jou mandjie.",
  scroll_up: "Rolle op.",
  scroll_down: "Rolle af.",
  going_back: "Ek gaan terug.",
  open_menu_first: "Maak eers 'n spyskaart oop.",
  ready_to_pay: "Gereed om {total} te betaal.",
  already_ready: "Hierdie bestelling is reeds gereed om te betaal.",
  stale_yes: "Daardie ja was vir 'n ouer mandjie. Vra my om die bestelling weer te lees.",
  need_readback: "Ek moet die bestelling teruglees voordat 'n ja tel.",
  okay_change: "Goed. Wat wil jy verander?",
  what_else: "Wat anders wil jy hê?",
  allergens_unknown: "Ek het nie allergeen-inligting nie. Niks op hierdie masjien het 'n bestanddeellys nie.",
  say_one_temp: "Sê een: warm, met ys, of kamer.",
  choose_temp: "Kies warm, met ys, of kamer.",
  add_or_confirm: "Voeg nog 'n item by, of sê ja om te bevestig.",
  not_carried: "Hierdie masjien het dit nie.",
  can_offer: "Ek kan {names} aanbied.",
  needs_temp: "{name} het nog 'n temperatuur nodig. Warm, met ys, of kamer?",
  need_temps: "{names} het nog 'n temperatuur nodig. Warm, met ys, of kamer?",
  removed: "Verwyder.",
  temp_saved: "Temperatuur gestoor.",
  added: "{temp}{name} bygevoeg.",
  added_need_temp: "{name} is in die mandjie. Warm, met ys, of kamer?",
  read_back: "Dis {lines}. Totaal {total}. Wil jy iets anders byvoeg, of sê ja om die bestelling te bevestig?",
  that_item: "Daardie item",
  which_item: "Watter item? {names}.",
  not_in_order: "Dit is nie in hierdie bestelling nie.",
  language_set: "Goed, ek sal {language} praat.",
  only_menu_tools: "Ek kan net op hierdie masjien soek, 'n kieslys-item byvoeg, of die bestelling teruglees.",
  session_abandoned: "Hierdie bestelling is skoongemaak.",
  unknown_product: "Daardie item is nie op hierdie masjien nie.",
  wrong_machine: "Daardie item is nie op hierdie masjien nie.",
  invalid_quantity: "Ek kan tussen 1 en 9 byvoeg.",
  invalid_temperature: "Kies warm, met ys, of kamer.",
  temperature_not_allowed: "Versnaperinge neem nie 'n temperatuur nie.",
  unknown_line: "Daardie lyn is nie meer in die mandjie nie.",
  incomplete: "Kies warm, met ys, of kamer voordat ek kan bevestig.",
  not_awaiting_confirmation: "Ek moet die bestelling teruglees voordat 'n ja tel.",
  stale_cart: "Daardie bestelling het verander. Vra my om dit weer te lees.",
  walked_away: "Die kliënt het weggeloop. Die mandjie is skoongemaak.",
  still_there: "Nog daar?",
  order_ends_in: "Niemand voor die masjien. Hierdie bestelling eindig oor {time}.",
  welcome_choose: "Welkom. Kies asseblief uit die opsies hieronder.",
};

const TABLES: Record<AppLanguage, Record<PhraseKey, string>> = {
  en: EN,
  es: ES,
  fr: FR,
  he: HE,
  af: AF,
};

const LANG_NAME: Record<AppLanguage, Record<AppLanguage, string>> = {
  en: { en: "English", es: "Spanish", he: "Hebrew", fr: "French", af: "Afrikaans" },
  es: { en: "inglés", es: "español", he: "hebreo", fr: "francés", af: "afrikáans" },
  fr: { en: "anglais", es: "espagnol", he: "hébreu", fr: "français", af: "afrikaans" },
  he: { en: "אנגלית", es: "ספרדית", he: "עברית", fr: "צרפתית", af: "אפריקאנס" },
  af: { en: "Engels", es: "Spaans", he: "Hebreeus", fr: "Frans", af: "Afrikaans" },
};

/** Translate a fixed agent line. Catalog product names stay English in {name}/{names}/{lines}. */
export function t(language: AppLanguage | null | undefined, key: PhraseKey, params: Params = {}): string {
  const lang: AppLanguage = language && TABLES[language] ? language : "en";
  let out = TABLES[lang][key] ?? EN[key];
  for (const [name, value] of Object.entries(params)) {
    out = out.replaceAll(`{${name}}`, value == null ? "" : String(value));
  }
  return out;
}

export function languageDisplayName(inLanguage: AppLanguage, target: AppLanguage): string {
  return LANG_NAME[inLanguage]?.[target] ?? LANGUAGE_FALLBACK[target];
}

const LANGUAGE_FALLBACK: Record<AppLanguage, string> = {
  en: "English",
  es: "Spanish",
  he: "Hebrew",
  fr: "French",
  af: "Afrikaans",
};

/** Spoken temperature word kept in catalog English (hot/iced/room) for read-back clarity. */
export function tempLabel(temperature: string | undefined): string {
  return temperature ? `${temperature} ` : "";
}
