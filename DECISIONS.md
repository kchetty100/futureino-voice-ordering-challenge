# Decision log

Written as the work happens. Each entry records what was decided, the alternatives, why, and what to revisit.

The catalog and the order engine live in `src/`. The coffee and snack photos are unlabeled studio shots. None of the 48 photos show a printed name, price, or ingredient panel.

## 2026-10-01 — The order engine owns the cart

**Decided:** A server-side order state machine is the only component that can change the cart, complete a line, or move an order to ready-to-pay. Voice and touch both call it. The model may search the active machine's catalog, propose a line, and request confirmation. The engine accepts or rejects the proposal.

**Alternatives:**

- A speech-to-speech session (OpenAI Realtime or Gemini Live) that hears, decides, and speaks, with the screen mirroring the session.
- A prompt-only chatbot that emits the order as JSON at the end of the transcript.

**Why:** The brief will be tested on trust. Nothing is ordered without a clear yes. Nothing is offered that the machine does not carry. Allergens are not invented. A coffee without a temperature is not an order. The screen and the voice show the same cart. Those rules can be unit-tested on an engine. A prompt can still skip them, and a speech-to-speech session would still need this engine underneath.

**Revisit:** If a working cascade still feels too slow in a noisy-room test, put a realtime voice session in front of the same engine. The session still cannot write the cart itself.

**What did not work:** Nothing has been implemented, so this is untested in a browser.

## 2026-10-01 — One Next.js app

**Decided:** One Next.js (App Router) TypeScript app. The kiosk, the order API, and the operator view deploy together. Model and speech keys live in server environment variables.

**Alternatives:**

- A Vite React client with a separate API (FastAPI or Hono).
- A Python-only app.

**Why:** The submission has to run on a laptop and a phone, keep secrets out of the browser, and be changeable live in a review. One TypeScript app is the smallest surface that does all three. A second service adds a deploy and a protocol to explain before the order rules exist.

**Revisit:** If Next.js gets in the way of streaming audio, keep the UI and move the voice route to a small server in the same repo.

## 2026-10-01 — Tap-to-talk, with touch as a peer

**Decided:** The microphone opens only while Talk is held or toggled. The transcript is shown on screen. Tapping again stops playback. Browse, temperature, cart edits, and Confirm stay on screen and write the same cart as voice.

**Alternatives:**

- An always-open microphone with a wake word.
- Voice only, with no touch path.

**Why:** These machines stand in malls, gyms, offices, and event halls. People nearby talk to each other. An open mic will start turns from those conversations. The hardware already has a touchscreen, and a bad transcript should not trap the customer. Tap-to-talk is the noise control an MVP can actually ship.

**Revisit:** A wake word, after tap-to-talk works and there is a recording of false triggers to test against.

## 2026-10-01 — Catalog, temperature, and allergens

**Decided:** We author the catalog from the photos: a name, a price, and taste tags per item. Every item stores allergens as unknown, and the agent says it does not know. Each coffee line requires a temperature of hot, iced, or room. A session is bound to one machine. The other machine's products are not searchable.

**Alternatives:**

- Infer allergens from appearance (a caramel-looking drizzle implies dairy, a nut photo implies a nut allergen).
- Turn each coffee into three products, one per temperature, instead of one product plus a required modifier.
- One shared catalog for both machines.

**Why:** The photos contain no names, prices, or ingredient text. Guessing allergens would break the rule against inventing facts, allergens especially. Temperature as a modifier matches "a coffee without a temperature isn't an order" and keeps the grid to the 18 coffee photos. Separate catalogs make "never offer a product it doesn't have" a filter in code.

**Revisit:** If a later photo shows printed ingredients, record those facts on that item only and note the source. Leave every other item unknown.

## 2026-10-01 — One state object per turn

**Decided:** Each assistant turn is one object: the line to speak, the phase, the spotlighted product ids, the cart, and the missing fields. The screen renders that object. Text-to-speech speaks only the line inside it.

**Alternatives:**

- Let the model speak freely and parse the transcript to update the UI.
- Two generators, one for speech and one for the screen.

**Why:** The brief says what the machine talks about is what the customer sees. With one object, a disagreement is a bug in a renderer.

**Revisit:** If the spoken line needs to be shorter than the on-screen detail, add a `shortSpeech` field on the same object. Do not add a second generator.

## 2026-10-01 — Access, cost, and the operator view

**Decided:** The deployment sits behind a password, or an equivalent gate, and is not indexed. Sessions are rate-limited, with a spend bound. An operator page lists past sessions with the transcript, cart versions, and a cost estimate from logged token counts and audio seconds. The customer flow ends at ready-to-pay.

**Out of this MVP:** payment, customer accounts, and a custom wake word.

**Alternatives:**

- A public demo URL with only the API key hidden on the server.
- Calling the model from the browser with a public key.
- Including payment because the real machines take cashless payments.

**Why:** The submission says the app must not be open to the public or scrapeable, no secret key may reach the browser, and nobody should be able to run up usage. They also asked to review past conversations and to know what a conversation costs. Payment is explicitly out of scope; the flow stops where the customer would pay.

**Revisit:** The exact gate, host password protection or an app login, when the host is chosen. The cost formula when the speech vendor is chosen. Use a speech service we already have; if we need a key, ask meir@sweetrobo.com before building against that service.

## 2026-10-01 — Build order

**Decided:** This log, then the catalog, then the order engine with tests, then the touch kiosk, then a text agent on the same API, then tap-to-talk, then the operator view and the deploy.

**Alternatives:**

- Start with a realtime voice demo and fit the rules around it.
- Design the full UI before the order rules exist.

**Why:** The live review will try to break the order. Tests on the engine are the thing to point at. Voice needs a speech key and is the step most likely to slip. The touch path can already show a complete order.

**Revisit:** After the text agent works, if a speech key is already available and the engine tests are green.

## 2026-10-01 — Catalog authored from all 48 photos

**Decided:** The menu lives in `src/catalog` as TypeScript. Each item has an id matching its filename, a menu name, a one-line summary, a photo note, a price in USD cents, taste tags, `allergens: "unknown"`, and `requiresTemperature`. Boost Coffee is 18 items and every one requires hot, iced, or room. Snacks Bot is 30 items and none take a temperature. Prices are list prices we chose, in a vending range of about $1.60–$4.80. Taste tags are a fixed set (`sweet`, `light`, `rich`, `spicy`, and so on) so a vague request can be filtered in code.

**Alternatives:**

- Wait for the Next.js app and store the menu in a database.
- One JSON file with free-typed tags.
- Copy drink prices from the Futureino marketing site.

**Why:** The order engine is next and needs a typed menu it can reject against. The photos are the source, and a database adds nothing until an operator is editing stock. The site's prices are sales copy for the machine, not a menu for this image pack.

**Revisit:** If an operator needs to change a price without a deploy, move the same fields into a table. Do not loosen the types.

**What we found:** Every photo in `images/coffee` and `images/snacks` was opened. None show a printed name, price, or ingredient list. Allergens stay unknown on every item. The coffee folder is a beverage menu, not coffee alone: it includes tea, matcha, juice, and chocolate-style drinks. The brief says every drink on that machine is hot, iced, or room temperature, so the temperature rule covers all 18, not only the coffee-looking ones.

## 2026-10-01 — A visible peanut is not an allergen fact

**Decided:** When the photo shows a peanut, almond, or similar food, the summary and photo note say what is visible. `allergens` stays `"unknown"`. The agent may say the picture shows something that looks like peanuts. It may not say the item is safe, and it may not state a confirmed allergen.

**Alternatives:**

- Set `allergens: ["peanuts"]` on any item where nuts are visible.
- Leave the photo note out and let the model describe the image later.

**Why:** The trust rule is that unknown facts, allergens especially, are spoken as unknown. A studio photo is not an ingredient panel. It also misses milk, gluten, and anything inside a coating. Putting the visible food in the data keeps the model from inventing a different snack, without promoting that description into a safety claim.

**Revisit:** Only if a photo is replaced with one that shows a printed ingredient list. Record those allergens on that item and note the source.

## 2026-10-01 — Covered Cup

**Decided:** `coffee-15` is named Covered Cup, with `nameBasis: "contents-hidden"` and no taste tags. The lid is closed, nothing sits beside the cup, and the drink cannot be seen.

**Alternatives:**

- Assign a flavor such as house blend or cappuccino so the grid has no blank.
- Drop the image from the menu.

**Why:** The pack includes the image, so the machine can sell the item. Inventing a flavor would be a fact the photo does not support. Dropping it would hide a product the machine has. The agent has to say it does not know what is in the cup. The line still needs a temperature before the order is complete.

**Revisit:** If Futureino names that frame. Until then the name stays a label, not a flavor.

## 2026-10-01 — Order engine rules

**Decided:** `src/order/engine.ts` is a pure state machine and the only writer of a cart. A drink can sit in the draft without a temperature. `read_back` and `confirm` both refuse until every Boost Coffee line is hot, iced, or room. `confirm` must send the cart version the customer was shown. A mismatch is `stale_cart`. Saying yes to the new cart without a fresh read-back is `not_awaiting_confirmation`. Silence does not move `lastActivityAt`. At 20 seconds the engine prompts once. At 45 seconds it abandons the session, clears the cart, and a later yes fails. The same product at the same temperature merges. A quantity is 1–9. An edit after ready-to-pay returns the cart to drafting and needs a new read-back. A rejected product still counts as activity, so a wrong request does not look like a walk-away.

**Alternatives:**

- Refuse to add a drink until the temperature is already known.
- Treat silence as activity so the idle clock resets whenever the mic is quiet.
- Let a spoken yes apply to whatever is in the cart at that moment.
- Skip the timeout and leave the cart up until the next customer starts a new session.

**Why:** The review will try a missing temperature, an item from the other machine, a yes after the cart changed, a quiet customer, and someone walking off. Those are tests on this module. An incomplete draft matches the way people order: "a latte", then "iced". Pinning confirm to a version stops a yes from landing on a cart they did not just hear.

**Revisit:** The 20s and 45s timings after a test in a noisy room. The quantity cap if a real machine allows larger orders.

**How we checked:** `npm test` runs these cases against the catalog. No model is involved.
