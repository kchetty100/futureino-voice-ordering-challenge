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

**Decided:** We author the catalog from the photos: a name, a price, and taste tags per item. Every item stores allergens as unknown, and the agent says it does not know. Each coffee line requires a temperature of hot, iced, or room. A snack does not. One order can hold both.

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

**Revisit:** The 20s and 45s timings after a test in a noisy room. The quantity cap if a real machine allows larger orders. A confirmed order on the pay screen does not use this clock. The customer leaves it with New order.

**How we checked:** `npm test` runs these cases against the catalog. No model is involved.

## 2026-10-01 — Touch kiosk

**Decided:** A Next.js screen calls the order engine for every tap. The session stays in the browser until a text agent needs one shared server session. On a laptop the screen sits in a portrait bezel. On a phone it fills the display. The path is attract, machine choice, product grid, a sheet for temperature and the unknown-allergen line, cart, read-back, then ready-to-pay. The engine gained three commands for that screen: `activity` for "I'm here", `revise` for "Change order", and `cancel` for "Start over". Product photos stay in `images/` and are served from there. Names were not renamed.

**Alternatives:**

- Keep a second cart in React state and copy it into the engine at confirm.
- Put the session on the server before there is a second client.
- Build voice in the same step.

**Why:** The touch path is how we show the engine is the only writer of the cart. A second cart would drift from those rules. A server roundtrip can wait until voice and touch have to share one order. Voice still needs a speech key.

**Revisit:** Move this same session onto the server when the text agent is added. Adjust the bezel if a real machine resolution is specified.

## 2026-10-01 — Text agent and server session

**Decided:** The cart lives in an in-memory server session. Tap and type both call it, so they share one order. `POST /api/sessions` opens a machine. `POST /api/sessions/:id` sends a touch command. `POST /api/sessions/:id/message` sends typed text. The agent may search the menu and draft a line. It has no confirm tool. A clear yes or no is handled in code before any model runs, and only that decision calls `confirm` with the cart version on screen. "Yes?", "Yes,", "yes please", "confirm", "proceed", and a misspelling such as "confrirm" are still a yes. When the cart is complete, the read-back asks whether to add anything else or say yes to confirm. "No", "nothing else", "that's it", and "I'm good" confirm. "Something else" keeps the cart and asks what they want. A reply that is not an item does not get "this machine doesn't carry that." When the order is waiting for that yes and the wording is not in the list, `gpt-4o-mini` classifies the reply as confirm, decline, or other. Only confirm calls the engine. A yes that also changes the order is not a confirm. The model still has no confirm tool. The words on screen are built from the engine result. If `OPENAI_API_KEY` is missing, or the model call fails, the same rules answer. The key stays in server env.

**Alternatives:**

- Let the model write the cart and the confirmation from free text.
- Keep the session in the browser and send a copy to the agent.
- Require an API key before the typed path works.

**Why:** The review will try a yes after a change, a missing item, and an allergen question. A model that can confirm by wording can put a drink in the order the customer did not accept. A browser cart and a server cart would diverge. The rules path is what the tests run, so the demo still works with no key.

**Revisit:** The in-memory map does not survive a restart or a second server instance. Move it when we deploy. English reply templates stay until voice needs other languages. The model, if a key is present, is `gpt-4o-mini` and only through the same tools.

**How we checked:** `npm test` covers the typed cases with the rules agent. The kiosk posts to the session API.

## 2026-10-01 — Tap-to-talk

**Decided:** Tap Talk once to start a conversation. The microphone stays open for that conversation: it sends a turn when the customer pauses, the machine speaks the on-screen line, then it listens again. Tap the button again to end the conversation and close the microphone. The clip is transcribed on the server in English with the same `OPENAI_API_KEY`, and the transcriber is given this machine's item names. A drink and its temperature in one sentence are one draft. A heard name that shares the consonants of exactly one item still counts as that item, so a clipped "maricano" is the Americano. Then it takes the same turn as typed text. If the rules already changed the cart, that result wins over a model draft that adds extra items. Playback is text-to-speech of the line already on screen, and only that line. The microphone does not record while the machine is speaking. The models are `gpt-4o-mini-transcribe` and `gpt-4o-mini-tts`. A sentence joined by and, plus, or a comma adds each clear item. A product whose name contains and, such as Cookies and Cream Bar, stays one item.

**Alternatives:**

- A speech-to-speech session that talks on its own.
- Hold the button for every sentence.
- Speak a second script that is not the on-screen line.

**Why:** Holding the button for every temperature and every yes made the order feel like a walkie-talkie. A conversation still starts and ends with a tap, so the microphone is not open while the machine is idle. A spoken yes still has to hit the same confirm rule as a typed yes. If the voice said something the screen did not, the review would fail the "screen and voice agree" check.

**Revisit:** Another language once the replies themselves are translated. A shorter spoken line if the read-back is too long in a noisy room. The pause length if a quiet customer gets cut off, or a noisy room never pauses.

## 2026-10-01 — Opening screen and the other machine

**Decided:** Talk is on the opening screen, before a machine is chosen. "Coffee", "snacks", or a product name opens that machine and starts the order. Asking what the other machine has, or saying "I would like to add a snack" during a coffee order, shows the snack menu. The coffee stays in the cart. A named snack is added beside it. The read-back includes both. When the coffee or snack page is showing because they asked for that menu, the reply is "Please view the items below." It does not name sample items. On the cart, "remove the latte", "add one more", "one less", and "make it hot" change that line and read the order back. The cart page stays up.

**Alternatives:**

- Keep Talk only after a machine is tapped.
- Open Snacks Bot as a new order and leave the coffee behind.
- Answer "this machine doesn't carry that" and stay on the coffee page.

**Why:** The first choice is which menu they see, and they can say it. A follow-up about snacks is another item on the same order, not a second cart. A drink still needs hot, iced, or room. A snack does not.

## 2026-10-01 — Customer phrases

**Decided:** Each item can carry phrases a customer actually says, such as "yellow bag" for Potato Chips and "black coffee" for both Americano and Daily Black. A phrase that fits one item is added. A phrase that fits two is asked back, with those items highlighted. Taste words such as "crunchy" list matching items and do not pick one. When the rules do not already recognize the sentence, `gpt-4o-mini` returns menu ids in a fixed JSON shape. Code drops any id that is not on the menu. That call cannot confirm. The transcriber is primed with every name and phrase from both machines on every turn.

**Alternatives:**

- Leave matching on the printed menu title only.
- Let the model add whatever product it names in free text.
- A speech-to-speech session that chooses the item itself.

**Why:** People do not order by the title on the photo. A shared phrase has to stay a question, or "black coffee" would silently become one of two drinks. The engine still writes the cart, and a yes still goes through the confirm check.

## 2026-10-02 — Operator view

**Decided:** `/operator` lists each session still held in memory: the transcript, every cart version, and a cost estimate. Typed lines, voice lines, and taps are separate. A tick that does not change the cart is not a turn. Walking away is one system line and a new empty cart version. The page asks for `OPERATOR_PASSWORD` and sets an httpOnly cookie. It is marked noindex. The password stays in server env.

Cost uses the published token rates. `gpt-4o-mini` and `gpt-4o-mini-transcribe` use the usage object on the response. A transcribe response with no token counts falls back to $0.003 per minute of the recorded clip. `gpt-4o-mini-tts` does not return usage, so playback is estimated at about $0.015 per minute of speech plus the text input. The page and the API share that memory on the process. The log does not survive a restart or a second server.

**Alternatives:**

- A public orders page with the API key still hidden.
- Saving every session to a database before the host is chosen.
- Guessing the speech bill only from audio seconds and ignoring token counts.

**Why:** The review needs to see what was said, what the cart became, and what it cost. A database can wait until deploy, because the process that served the customer is the one the operator is looking at. The password is the gate that exists before a host is chosen.

**Revisit:** Move the same log when the process is no longer one laptop. Rate limits and the host lock are the deploy step. Replace the speech estimate if the speech API starts returning a usage object.

## 2026-10-02 — Vercel

**Decided:** The app is deployed from `main` on Vercel, project `futureino-voice-ordering-challenge`, team keegan's projects (Hobby). The URL is https://futureino-voice-ordering-challenge.vercel.app. `OPENAI_API_KEY` and `OPERATOR_PASSWORD` are set on Production and Preview as sensitive server variables. The kiosk is public. `/operator` still asks for the operator password. There is no host-wide password and no rate limit yet.

**Alternatives:**

- Keep it on the laptop only.
- Put the whole deployment behind Vercel's password, which needs a paid plan.

**Why:** The submission needs a URL that opens on a laptop and a phone. Vercel already builds this Next.js app. The speech key stays on the server.

**Revisit:** A host password or rate limit if the public kiosk can run up the speech bill. The cart and operator log still live in one process, so a second Vercel instance can miss an order. A voice turn can also exceed the function time limit.

## 2026-10-02 — Shared cart on Vercel

**Decided:** The cart and the operator log are written to Upstash Redis when `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are set. The Vercel marketplace names `KV_REST_API_URL` and `KV_REST_API_TOKEN` count as the same store. Each turn reads that store first and writes it back at the end, so a different instance can continue the order and `/operator` can list it. Records last 7 days. With those variables unset, the laptop keeps the cart in process memory.

**Alternatives:**

- Leave the maps in memory and accept that `/operator` can miss a live order.
- Send the cart back to the browser and trust the browser to return it unchanged.

**Why:** The live kiosk finished an order, then `/operator` on another instance said there were no orders. The engine stays the only writer. The browser still only sends the session id.

**Revisit:** A host password or rate limit if the public kiosk can run up the speech bill.

## 2026-10-02 — Kiosk UI: voice-first layout

**Decided:** Menu dock is compact: Talk stays visible but shorter; cart collapses to a one-line summary that expands for edits; typing is behind "Type instead"; Review stays pinned. Attract leads with Talk and the line "Say coffee, snacks, or tap"; tap-to-browse remains secondary. Talk has distinct listening / thinking / speaking chrome; product and cart taps disable while thinking; network failures use a clearer banner. Spotlighted cards get cyan fill + glow, and the first spotlight scrolls into view.

**Alternatives:** Keep the full cart always open; hide Talk on Attract behind a second step; rely on border-only spotlight.

**Why:** The product grid and Review CTA were losing space to Talk + composer + cart lines. Voice is the intended path; typing is overflow. Turn state and spotlight need to read at arm's length.

**Revisit:** Cart expand max-height if long orders feel cramped. Whether thinking should also block Talk end (currently Talk can still end).

## 2026-10-02 — Local navigation voice commands

**Decided:** Rules parse a small set of movement phrases before product search. `parseNavIntent` maps open/view cart, scroll up/down, and clear/empty cart. Machine returns ("return to coffee screen", "coffee machine", "show snacks", …) stay in `requestedMachine`. Clear uses a new engine `clear` that empties lines and stays in browsing (unlike `cancel`, which abandons). Turn results carry `ui: open_cart | scroll_up | scroll_down` so the kiosk can open the cart dock or scroll the grid. Confirm yes/no paths are unchanged and still win first.

**Alternatives:** Let the model invent UI actions; reuse `cancel` for clear cart; drive scroll only from the browser with no server intent.

**Why:** The review will ask to see the cart, jump machines, and scroll without naming a product. Those must work with no API key and must not confirm an order.

**How we checked:** `npm test` and `npm run typecheck`. Phrase→intent cases live in `src/agent/phrases.test.ts`.

## 2026-10-02 — Multi-language MVP

**Decided:** Support five customer languages in this MVP: English (`en`), Spanish (`es`), Hebrew (`he`), French (`fr`), and Afrikaans (`af`). Session stores `preferredLanguage` and `languageSet`. Speech-to-text no longer hard-locks `language: "en"`; when the session language is unset, STT omits the language field so the model can auto-detect. `gpt-4o-mini-transcribe` only accepts `json`, so a `verbose_json` language label is not available and the spoken language is read from the words. When language is set, STT and TTS receive that language. Agent rule strings go through a small `src/i18n` phrase table (`t()`). Catalog product names stay English in spoken lines. Allergen replies stay “we don’t know” in every language — no invented ingredients. Explicit “speak Spanish / en español / עברית …” switches language even after lock; casual English product names after a Spanish lock do not flip back.

**Alternatives:**

- Full i18n of the kiosk chrome and every model prompt.
- Rely on the LLM alone to reply in the customer’s language with no phrase table.
- Force English STT forever and only translate TTS.

**Why:** The brief requires non-English customers. A phrase table keeps greetings, clarifies, confirm read-back, nav, cart edits, and errors trustworthy without an API key. Auto-detect STT removes the English lock that blocked non-English audio. Catalog English names keep matching stable. Afrikaans covers Johannesburg; Hebrew covers the Futureino/Sweetrobo context; Spanish and French are common mall languages.

**Tradeoffs / revisit:** Rules still match products mostly on English names/aliases, so “quiero un café con leche” may miss unless aliases cover it — the OpenAI understand path can help when a key is set. Yes/no/nav cues cover a small multilingual set, not every dialect. TTS `instructions` for non-English is best-effort. Expanding languages means adding phrase rows and cue words, not a new architecture.

**How we checked:** `npm test` (includes `src/i18n/language.test.ts`) and `npm run typecheck`. No commit for this change set until asked.

## 2026-10-02 — Attract + MachineChoice restyle

**Decided:** Attract and MachineChoice match the attached portrait references while keeping Talk-first. Attract is white with the existing Futureino logo, a neon-outlined “Welcome to Futureino”, and a large circular gradient Talk CTA labeled “Tap to start” (listening / thinking / speaking states unchanged). Browse machines stays a secondary text control. MachineChoice title is “What are you after?” (not “What are you at?”). A mic + transcript row reuses Talk state; two large cards use coffee-01 / snacks-01 merch photos (no machine illustrations in `brand/`), catalog blurbs, and readable “Say: Coffee / Snacks” chips. Back + “or Say: Back”; spoken “back” returns to Attract and clears transcript. Menu / Review / Pay / dock turn-state unchanged.

**Alternatives:** Side-by-side cards; invent new robot bitmaps; make the circular CTA tap-only to machines.

**Why:** References set the look; prior voice-first Attract must not regress to tap-only. Product photos fill the illustration gap without new assets.

**How we checked:** `npm run typecheck`.

## 2026-10-02 — Hey Future

**Decided:** The home screen says "Say Hey Future to start." Talk on that screen only transcribes. "Hey Future" (and a close mishear such as "hay future") opens the machine page. Any other words stay on the home screen. Browse machines still opens that page from a tap.

**Alternatives:** Keep "say coffee or snacks" on the home screen and open a menu from the first product name.

**Why:** The first words should wake the machine, and the next screen is where coffee or snacks is chosen.

**How we checked:** `isHeyFuture` in `src/agent/phrases.test.ts`.

## 2026-10-02 — Camera starts the microphone

**Decided:** The kiosk camera looks for a face. Two frames in a row open the microphone. About two seconds with no face closes it. A small mirrored preview and a status line stay on the screen. Tap to start still works, and it is the gesture that can grant the camera and the mic. Stopping Talk while a face is still there stays stopped until the person leaves and comes back. The video stays on the device. Nothing from the camera is uploaded.

**Alternatives:** Start the mic on any motion in the frame. Hide the camera. Require a tap every time someone walks up.

**Why:** A person standing at the machine should be able to say Hey Future without hunting for the button. Motion in a mall would open the mic for people walking past. The preview makes the camera obvious.

**How we checked:** `nextPresence` in `src/kiosk/presence.test.ts`. The home screen shows the camera status. A face in the automated browser could not be confirmed.

## 2026-10-02 — Mic closes while the machine speaks

**Decided:** The level meter uses its own audio context, separate from playback. The camera opens video only. The microphone closes before a reply is spoken, then opens again after a short gap. Automatic gain on the mic is off.

**Alternatives:** Leave the mic open for the whole visit. Keep measuring the mic inside the same context that plays the reply.

**Why:** On a Mac, an open mic with echo cancellation runs the speakers through voice processing, so the reply sounds like it is in a live room. A second mic from the camera made that start as soon as the page loaded. The meter and the speakers were also sharing one context, so the mic could color the playback.

**How we checked:** The home screen still shows the camera. Listening still waits out six seconds of quiet. A spoken reply in the room was not re-checked from this browser.

## 2026-10-02 — One tab speaks

**Decided:** If more than one kiosk tab is open, only the tab that was focused last listens and speaks. The others close the mic and drop playback.

**Alternatives:** Let every open tab play the reply. Ask the customer to close tabs.

**Why:** Each open tab was hearing the same sentence and speaking the reply, so the voice came out twice. The server log showed two sessions receiving speech at the same moment.

**How we checked:** `otherTabLeads` in `src/kiosk/solo.test.ts`. The dev log showed paired `/speech` calls before this change.

## 2026-10-02 — Password on the whole site

**Decided:** Every page and API route, including speech, asks for the existing operator password first. The sign-in page is `/enter`. A matching httpOnly cookie unlocks the kiosk and `/operator`. A wrong or missing cookie gets a redirect, or 401 on an API call. The password stays in `OPERATOR_PASSWORD` and is not sent to the browser.

**Alternatives:** Vercel sign-in, which needs a Vercel account on the project. Vercel Password Protection, which is not on Hobby. A speech rate limit alone, which would leave the menu public.

**Why:** The brief says the deployed app must not be open to the public, and a reviewer has to be able to get in without joining the Vercel team. The operator password is already set locally and on Vercel.

**How we checked:** `src/operator/secret.test.ts`. The home screen shows the lock before the password, and `/api/arrive` returns 401 without the cookie.

## 2026-10-02 — Go back works on every screen

**Decided:** "Go back", "previous page", and the other screen moves (show cart, scroll, clear cart, switch machine) work on the home screen, the machine choice, the menu, review, and pay. Back walks pay, then review, then the menu, then the machines, then home. An open product sheet closes first. The cart stays. "Go back to coffee" or "go back to snacks" still switches the menu.

**Alternatives:** Only the machine page understands "back". Start a new empty order when the customer returns to a machine.

**Why:** A customer who says previous page on review or pay was being treated as an order, or ignored. The same words should move the screen wherever they are standing.

**How we checked:** `parseNavIntent` and a rules turn in `src/agent/phrases.test.ts`. In the browser, typed "go back" and "previous page" walked pay, review, the menu, and the machine choice, kept the cart, closed an open product sheet first, and "go back to coffee" switched the menu. "Scroll down" moved the menu.

## 2026-10-02 — The camera ends a visit

**Decided:** The "Still there?" box is gone. A tick no longer prompts or clears the cart. The countdown stays off the home screen. After "Hey Future" leaves that screen, and the camera is watching and sees nobody for 10 seconds, the countdown starts. Then a circular countdown sits in the middle of the screen. The rest of the screen blurs behind it. The ring and the time stay sharp. If a face comes back, the countdown disappears and the cart stays. Going back to the home screen clears it. At zero the session ends. A blocked or missing camera does not start that clock. This includes the pay screen.

**Alternatives:** Keep the 20-second prompt and the 45-second walk-away. End the order as soon as the face is gone. Keep the pay screen up until New order, even if the customer has left.

**Why:** A person standing at the machine was losing the order because they had not tapped anything. The camera already knows whether someone is in front. The countdown gives them a minute to step back in.

**How we checked:** `leaveSecondsLeft` in `src/kiosk/presence.test.ts`. A quiet tick in `src/order/engine.test.ts` keeps the cart. The kiosk no longer renders the old prompt.

## 2026-10-02 — Silence is not an order

**Decided:** The transcriber hint no longer starts with "What snacks do you have?" A clip is sent only after about a third of a second of actual voice. If the transcript is just the opening of that hint, it is dropped and the machine does not answer.

**Alternatives:** Keep the snack question at the front of the hint. Treat every transcript as something the customer said.

**Why:** A quiet moment was coming back as the first line of the hint. That line asks for the snack menu, so the machine kept saying "Please view the items below."

**How we checked:** `isPromptEcho` in `src/agent/phrases.test.ts`. A real "what snacks do you have?" is not treated as the hint.

## 2026-10-02 — Repeating the drink is not a new order

**Decided:** While one drink is waiting for hot, iced, or room, hearing that same drink again does not add another. The machine asks for the temperature again and leaves the quantity alone. That includes a foreign spelling the menu model maps back to the same drink, such as 아메리카노 for Americano.

**Alternatives:** Treat every transcript as a new add. Lock speech-to-text to English so the Korean spelling cannot appear.

**Why:** The microphone stays on during the temperature choice. A clip of the drink name, often the machine's own previous "Americano" line written in Hangul, was added again and the temperature question started over.

**How we checked:** Saying "latte" again while a latte has no temperature keeps quantity at 1. A model add of that same drink with no temperature does the same.

## 2026-10-02 — A frequency line shows the microphone

**Decided:** While the microphone is open, a frequency line sits at the top of the screen. The bars follow the live voice range. They turn blue and the caption says "Voice captured" only when the level crosses the same gate that sends a clip. Otherwise the caption stays "Listening". The line hides while the machine is speaking or thinking, because the microphone is closed then.

**Alternatives:** A spinning listening dot with no level. A line that moves for any room noise, including levels too quiet to send.

**Why:** Hot, iced, or room was being asked with no sign of whether the microphone had the answer. The line shows that capture on the same screen as the question.

## 2026-10-02 — A short hot, iced, or room is sent

**Decided:** Once the voice stays above the gate for about a seventh of a second, a short pause sends the clip. The frequency bars stay flat until that gate is crossed, and the caption says "Voice captured" only after the word is long enough to send. Adding a snack while a drink still needs a temperature names that drink, and does not ask for a temperature on the snack.

**Alternatives:** Keep the third-of-a-second hold, which dropped a short "hot". Keep saying the newest item needs hot, iced, or room even when that item is a snack.

**Why:** The line was moving while "hot" never left the browser. A snack added beside an unfinished drink was then announced as if the snack needed a temperature.

## 2026-10-02 — Each drink in an "and" order gets a temperature

**Decided:** "A daily black and a mocha" adds both drinks. "Americano, mocha and cappuccino" adds all three, including a mishear such as "american, mocha and capacino", and a list with no comma such as "americano mocha and cappuccino". The cart opens with a hot, iced, or room choice on each one. A single temperature word sets the first drink still waiting and then asks for the next by name. "Both hot", "hot for both", and "cold for both" set every waiting drink. "Hot, iced and room" follows the cart order. "Daily black iced and mocha hot" sets each named drink.

**Alternatives:** One temperature word sets every drink. Ask "which drink?" and wait before setting any.

**Why:** A temperature used to apply only when exactly one drink was waiting, so the second drink in an "and" order could not be finished by voice.

## 2026-10-02 — A speech budget

**Decided:** Each speech call, and each typed turn while a speech key is set, must take a slot before OpenAI is called. One address gets 120 slots an hour. The whole site gets 800 slots per UTC day. The 801st call returns 429 and the kiosk shows "The machine is resting its voice. Try again in a little while." The count lives in Redis when the shared store is configured, and in this process otherwise. The address is the platform header `x-vercel-forwarded-for` when Vercel sends it.

**Alternatives:** Leave the password as the only limit. Cap dollars inside the estimator instead of counting calls. Use Vercel Firewall rules, which are a separate product.

**Why:** The password keeps the public out. It does not stop a signed-in page, or a leaked password, from looping transcription. A review can still talk through an order many times. A script cannot keep going all day.

**How we checked:** `src/operator/budget.test.ts`. The hour cap stops one address and still allows another. The day cap stops a fresh address. A Redis `INCR` past the hour cap is refused.

## 2026-10-02 — "Cookies and cream" stays one snack inside a list

**Decided:** "Cookies and cream" is a customer phrase for Cookies and Cream Bar. A name match ignores the word "and", so that phrase lines up with the alias. "Cookies and cream and potato chips and pretzels" adds three snacks: the bar, Potato Chips, and Pretzels.

**Alternatives:** Stop splitting on "and" whenever the words look like a name. Ask the customer to say the full "cookies and cream bar".

**Why:** Splitting on "and" turned the bar into "cookies" and "cream", neither of which was a single precise product, and the list collapsed to the last precise snack.

**How we checked:** The snack list in `src/agent/turn.test.ts`. "Cookies and cream bar" on its own is still one line.

## 2026-10-02 — A speech hint with a prefix is still not an order

**Decided:** A transcript is dropped when it is the speech hint, or when the hint's opening "Futureino menu words" appears anywhere in it. A real "Hey Future" is kept.

**Alternatives:** Drop any transcript that shares three words with the hint. Clear the transcriber prompt entirely.

**Why:** A quiet clip came back as "context: ### Futureino menu words..." which does not start with the hint, so the old check let it through as "You said".

**How we checked:** `isPromptEcho` in `src/agent/phrases.test.ts`.

## 2026-10-02 — A language button on the welcome screen

**Decided:** The welcome screen has a round button at the bottom, labeled with the current language code. It opens English, Español, Français, עברית, and Afrikaans. English stays selected until they tap another one. That choice is sent with the next clip and with a new order, so hearing and the spoken replies use it. Saying "speak Spanish" can still switch later. Until they tap, the first clip is still heard without a forced language.

**Alternatives:** Guess the language from the first sentence only. Put five labels on the screen all the time.

**Why:** A tap is reliable, and the welcome screen stays one circle until someone wants another language.

**How we checked:** The welcome screen shows EN. Opening it lists the five languages, and choosing Español leaves the circle on ES.

## 2026-10-02 — The screen follows the language button

**Decided:** Choosing a language changes the words painted on the kiosk: welcome, the machines, the cart, review, pay, temperatures, and the talk button. Product names on the cards stay English. Hebrew lays the screen out right to left.

**Alternatives:** Leave the screen in English and only translate what is spoken. Translate every product title.

**Why:** A customer who taps Español should see Español on the machine, not only hear it.

**How we checked:** `ui` in `src/i18n/language.test.ts`. On the welcome screen, Español changes Welcome to Bienvenido and the start line to Spanish.

## 2026-10-02 — Hey Future welcomes them onto the machines

**Decided:** After "Hey Future" on the home screen, the machine says "Welcome. Please make a selection from below." The same line is on the machine screen. A chosen language uses that language's line. Any other words on the home screen still ask them to say Hey Future.

**Alternatives:** Stay silent and only show the two machines. Say the line when they tap Browse as well.

**Why:** The wake phrase should hand them to the choice, out loud, and the screen should match.

**How we checked:** `wakeSay` in `src/agent/phrases.test.ts`.

## 2026-10-02 — A correction is not a yes

**Decided:** On review or pay, "that's wrong", "wrong item", "hold on", and "that's not right" step back to change the order. They do not confirm it. A model label of decline does the same, even when the sentence is not already a cart edit. A confirm label still has to be free of a change.

**Alternatives:** Let the confirmation model treat an unrecognized decline as yes. Only decline when the sentence contains "no" or "change".

**Why:** "That's wrong" missed the cart-edit words, the model was told to call that a decline, and the turn then accepted the order.

**How we checked:** `answerWithRules` keeps the latte and asks what to change. `confirmationDecision` returns decline for a model decline, and null for "yes but make it hot".

## 2026-10-02 — A spoken count is the quantity

**Decided:** "Two iced lattes" and "a couple of pretzels" add one line with quantity 2. Counts run from 2 through 9, plus "a couple" and "a pair". Two different counts in one sentence stay at 1. A trailing s is folded only when a count was spoken and the plural is not already a menu name, so "lattes" can mean Latte and "chips" still lists the chip snacks.

**Alternatives:** Always add one and wait for "one more". Ask the menu model for a quantity field.

**Why:** The add path ignored the number, so two drinks became one.

**How we checked:** `answerWithRules` for "two iced lattes" and "a couple of pretzels". "Chips" still offers Potato Chips rather than one cookie.

## 2026-10-02 — Free-from questions are allergen questions

**Decided:** "Gluten free", "nut free", and "does it have milk" get the unknown-allergen line. The cart does not change. The ingredient has to sit next to a word like free, contain, or have.

**Alternatives:** Only the words allergen and allergy. Guess from the photo.

**Why:** Those questions were falling through to "this machine doesn't carry that."

**How we checked:** `answerWithRules` on "is this gluten free?", "nut free?", and "does it have milk".

## 2026-10-02 — Cart edits follow the pinned language

**Decided:** "Added one more", "Removed", and "Latte is hot" use the same phrase table as the rest of the agent. A clarify from the menu model uses "I can offer" in that language too. Product names stay English.

**Alternatives:** Leave those four sentences in English.

**Why:** A Spanish session was still hearing English for a quantity change.

**How we checked:** An iced latte, language pinned to Spanish, then "one more", says "Añadí uno más de Latte".

## 2026-10-02 — Playback is not the next order

**Decided:** The microphone stays closed for 900 ms after the machine finishes speaking. A transcript that repeats the line just spoken, and is at least a short sentence, is dropped. A short "yes" is kept.

**Alternatives:** Reopen the mic the instant playback ends. Drop any transcript that shares a word with the line.

**Why:** A loud speaker can be heard as the customer, including a read-back that contains the word yes.

**How we checked:** `isPlaybackEcho` drops the full read-back and keeps "yes" and "two iced lattes".

## 2026-10-02 — A language tap does not drop the reply in flight

**Decided:** Choosing a language writes the pin with its own request. It does not cancel the voice turn that is already on the way back.

**Alternatives:** Send the language through the same request queue as an order.

**Why:** That queue keeps only the newest response. A language tap during thinking threw away the spoken line, and the cart could appear a second later with no audio.

The welcome line already on screen moves with the button too, so it does not stay in the previous language next to the new one.

## 2026-10-02 — A generic wipe empties the cart

**Decided:** "Remove everything from the cart", "remove all of it", "delete everything", "start over", "scratch that", and "get rid of all of it" empty the cart and leave the visit open. "Remove all the lattes" removes only that product. The model may also return clear, remove, set a quantity, or set a temperature. The engine still applies those actions, and a model still cannot confirm. A cart edit that already named a line stays with the rules. A remove that matched no line can go to the model.

**Alternatives:** Let the one-item remove rule keep any sentence that contains "remove". Let the model write the cart in its own words.

**Why:** "Remove everything" was read as "remove one line," and the model was never asked. Its menu map could add a product, not empty the cart.

**How we checked:** `answerWithRules` clears a latte and chips for those wipe phrases, and "remove all the lattes" leaves the chips. `applyHeard` clears, removes one product, and sets a quantity of 3. "Remove the latte" still removes one line.

## 2026-10-02 — A counted list with one temperature

**Decided:** "Give me 1 american, 2 mocas and 1 latte all hot" is three lines: one hot Americano, two hot Mochas, and one hot Latte. Each part keeps its own count. "All hot" at the end applies to every drink in that list that did not name its own temperature. A misspelling is accepted only when it shares the first three letters of a single menu name and is one consonant off, so "mocas" can mean Mocha and "wrong" does not become a drink.

**Alternatives:** Send every list to the model. Add "mocas" as a one-off alias.

**Why:** The list splitter kept the drinks and dropped the counts, and "all hot" was stuck on the last drink. "Mocas" was not close enough for the exact name score, so the whole list was discarded.

**How we checked:** `answerWithRules` on that sentence. "That's wrong" on review still asks what to change.

## 2026-10-02 — A quiet tick does not touch the shared cart

**Decided:** The kiosk no longer posts a tick every second. A tick that does arrive is read and not written back. The visit still ends from the camera countdown, which posts cancel.

**Alternatives:** Keep the poll so a second server could push a change into this tab.

**Why:** The tick no longer changes the cart. With Redis on, each one still read the session and wrote it back, about once a second, on every open order.

**How we checked:** `commandSession` with a tick leaves the operator transcript length unchanged. The kiosk has no one-second session poll.

## 2026-10-02 — A camera that cannot see still ends the visit

**Decided:** When the camera is watching and sees nobody, the countdown is unchanged: 10 seconds, then one minute. When the camera is blocked, still starting, or face detection did not load, the same one-minute countdown starts after three minutes with no tap and no spoken turn. A tap or a spoken turn moves the last activity and clears it. A face in front still keeps the cart. The home screen does not count down.

**Alternatives:** Leave a denied camera running until someone taps New order. Use the 10-second face clock for a denied camera too.

**Why:** A blocked camera never started the clock, so an open order and an open microphone could sit there. A person who is still ordering resets the quiet window by talking or tapping.

**How we checked:** `leaveSecondsLeft` with the three-minute window. A working camera still waits 10 seconds of an empty frame.

## 2026-10-02 — Eight wrong passwords, then a wait

**Decided:** Eight wrong passwords from one address in 15 minutes lock that address for the rest of the window. The sign-in page says to wait. A different address is unaffected. The password stays one shared `OPERATOR_PASSWORD`. The count lives in Redis when the shared store is configured, and in this process otherwise.

**Alternatives:** A separate account per reviewer. Vercel Password Protection, which is not on Hobby.

**Why:** The shared password is what a reviewer can type without a Vercel account. Nothing was slowing a script that guessed it.

**How we checked:** `noteFailedLogin` locks the eighth failure and leaves the next address open.

## 2026-10-02 — The cart comes back before the voice

**Decided:** A voice turn returns the cart and the on-screen line as soon as they are known. The audio is a second request, signed for that exact line, and it can be used once. The screen still says the line the speaker reads.

**Alternatives:** Keep transcription, understanding, and speech inside one response, with the audio as base64. Stream the audio inside that same response.

**Why:** Those three steps in one function are the long silence, and on Hobby the call can run out of time before the cart ever reaches the screen.

**How we checked:** `issueSpeakTicket` accepts the line once and rejects a second use, a different line, and an expired permit. The speech route no longer waits on synthesis.

## 2026-10-02 — Nearby talk does not change the cart

**Decided:** A transcript changes the cart only when it is an order, a menu question, a yes or no, or a cart edit. Anything else gets "I didn't catch that" while browsing, or the confirm reminder on review, and the model is not asked. A model add, remove, or temperature is kept only for a product the customer named.

**Alternatives:** Send every transcript to the model. Drop the microphone unless the customer says Hey Future before every sentence.

**Why:** People near the machine talk to each other. A clip of the machine's own line was already ignored. Other mishears could still become a cart change.

**How we checked:** "What time does the movie start" leaves an iced latte in place. "She was telling me the latte shop is closed" adds nothing. A model add of Latte from that movie sentence is dropped. "I'll have the mocha please" still names Mocha.

## 2026-10-02 — A close miss of hot or cold still counts

**Decided:** A word one letter off hot, cold, iced, ice, or room, and no longer than that word, is that temperature. "hod" is hot. "cod" is cold, which is iced. "hat", "not", and "could" stay themselves.

**Alternatives:** Add hod and cod as one-off aliases. Send every temperature to the model.

**Why:** Speech often drops or swaps one letter in a short word. The temperature check was looking for the exact spelling, so the drink stayed unfinished.

**How we checked:** A latte waiting for a temperature accepts "hod" as hot and "cod" as iced. "hat" does not set one. "could I get a latte" does not come back iced.

## 2026-10-05 — Start does not ask for Hey Future

**Decided:** Tap to start opens the two machines and says welcome. The first thing the customer says can be the order. "Hey Future" is no longer required after the button.

**Alternatives:** Keep the wake phrase so a nearby voice does not open the machines. Start listening on the home screen and still wait for the phrase.

**Why:** The button is already the trigger. A second keyword made the customer say a password before they could order.

**How we checked:** The home screen no longer tells them to say Hey Future. Tap to start requests the welcome line and shows the machines.

## 2026-10-05 — Tap opens the menu; leave is idle-only

**Decided:** The kiosk no longer uses the camera. There is no getUserMedia video, no face detector, and no presence→mic link. Tap to start opens a session for `NEXT_PUBLIC_MACHINE_ID` (coffee by default, or snacks), shows that machine’s menu with listening on, and speaks the welcome line. Hey Future is not required after the tap. Walk-away is idle only: three minutes with no order activity, then a one-minute “Still there?” countdown. Attract does not count down. “Or browse machines” is gone from Attract; MachineChoice remains only for go-back edge cases.

**Alternatives:** Keep the camera for a 10-second face-away leave. Tap into the two-machine picker first. Auto-listen on Attract for Hey Future without a tap.

**Why:** Reviewer point 1 asked to remove the camera from the kiosk UX. The tap is enough consent to start; a wake phrase after it was a second gate. Idle leave matches a single-machine kiosk that cannot see whether someone is still in front.

**How we checked:** `npm test` and `npm run typecheck`. Tap to start should land on the Boost Coffee menu with the mic listening and no camera chrome.


## 2026-10-05 — Menu is one catalog, not two machine tabs

**Decided:** The Menu top bar shows only the current machine name. Coffee/Snacks tab chips and Attract “browse machines” / “Say Coffee|Snacks” chrome are gone. MachineChoice markup stays for Engineer’s go-back / `machines` screen edge path; spoken `choose_machine` phrases are untouched.

**Alternatives:** Keep dual tabs so a tap could flip catalogs without voice. Delete MachineChoice in the same pass as routing.

**Why:** A bound kiosk (`NEXT_PUBLIC_MACHINE_ID`) should read as a single catalog. Tab chrome implied switching machines.

**How we checked:** `npm run typecheck`. Menu header has no machine tab buttons; Attract has no browse link.

## 2026-10-05 — Bound kiosk: no MachineChoice, no mid-order switch

**Decided:** Drop the `machines` screen and `MachineChoice` UI. Tap to start still opens `DEFAULT_MACHINE` (`NEXT_PUBLIC_MACHINE_ID`, coffee by default) with listening on. Back from Menu returns to Attract, not a picker. Voice no longer sets `switchTo` to flip catalogs mid-order; asking for the other machine gets `wrong_machine`. Orphan camera files (`watch.ts`, `presence.ts`, `presence.test.ts`) and unused camera / MachineChoice i18n keys are deleted.

**Alternatives:** Keep MachineChoice only for go-back. Keep spoken return-to-coffee/snacks as a catalog flip while leaving Attract single-machine.

**Why:** UI Designer already removed dual Coffee/Snacks chrome. A bound kiosk should not offer a second machine path in UI or speech.

**How we checked:** `npm test` and `npm run typecheck`. Tap → menu; Back → Attract; cross-machine speech stays on the session machine.

## 2026-10-05 — Wipe leftover MachineChoice chrome

**Decided:** After MachineChoice left the render path, delete only its leftover CSS (`.choose`, `.machineCards`, card/voice-row/back chrome) and confirm the picker i18n keys were already gone. Do not touch routing, `DEFAULT_MACHINE` / `MACHINE_ID`, spoken `choose_machine` phrases, or tests beyond type errors from deleted keys.

**Alternatives:** Leave dead CSS until a broader restyle. Delete spoken machine-choice phrases in the same pass.

**Why:** Bound kiosk UI should not keep dual-machine picker styles that nothing references.

**How we checked:** `npm run typecheck`. No `MachineChoice` / picker chrome key refs in `Kiosk.tsx`; picker CSS classes have zero defs.

## 2026-10-05 — Demo Attract picker vs production one-machine unit

**Decided:** Attract is a white Futureino demo picker: logo + neon welcome, “Tap a machine” hint, and two large cards (Boost Coffee / Snacks Bot) with coffee-01 / snacks-01 photos and staggered fade + slide-up load-in. One tap calls `onSelectMachine(machineId)` → `start(machineId)` → menu with listening on and `welcome_choose` (via `beginFromMachine`) — no second Tap-to-start, no camera. Mid-order speech that names the other machine still gets `wrong_machine` (no catalog flip). Back from Menu returns to Attract with both cards. `NEXT_PUBLIC_MACHINE_ID` / `DEFAULT_MACHINE` remain an optional production one-machine-per-unit bind; this demo Attract always offers both.

**Alternatives:** Keep Attract Tap-to-start bound to a single `DEFAULT_MACHINE`. Restore a separate MachineChoice screen. Allow mid-order machine switch.

**Why:** Reviewers need both catalogs in one browser session. A real unit would ship one machine id; the picker is demo chrome, not a production multi-catalog cart.

**How we checked:** `npm test` and `npm run typecheck`. Tap a card → that menu + mic; Back → both cards; cross-machine speech stays `wrong_machine`.


## 2026-10-05 — Circular listening meter beside Talk

**Decided:** Replace the absolute full-width `VoiceLine` bar (top of `screenFace`) with a 48px circular frequency meter. Bars are clipped inside the circle. Render it in a `voiceRow` beside Talk on Menu / Review / Pay, only while listening. Sampler / `VOICE_BARS` unchanged; the circle shows every other bar for readability. Talk still owns listening / thinking / speaking labels.

**Alternatives:** Keep a top overlay but shrink it. Put the meter inside the Talk button. Change audio sampling for fewer bars.

**Why:** The old bar overlapped the topbar, transcript/`Reply`, and product grid. A dock-adjacent circle stays out of cart and grid chrome.

**How we checked:** `npm run typecheck`.

## 2026-10-05 — Menu opening skeleton while session resolves

**Decided:** While Engineer’s `opening` flag is true (Attract tap → session live), Menu paints six shimmer product-card placeholders instead of the catalog grid. The Talk / speaking voice row stays in the dock so chrome moves with the grid. Skeleton hides as soon as `opening` clears.

**Alternatives:** Full-screen spinner. Show real catalog cards immediately (local) and only dim them. A separate `sessionPending` flag.

**Why:** Optimistic menu already removes the Attract→session blank; a light skeleton keeps the handoff from feeling stuck without inventing a parallel pending state.

**How we checked:** `npm run typecheck`. Tap a machine → skeleton + Talk; session live → real cards.


## 2026-10-05 — Dark Attract restyle: Tap or Speak orb + machine cards

**Decided:** Attract is now a dark navy→purple home screen (supersedes the white demo picker look). Header: transparent Futureino logo (`brand/futureino-logo-clear.png`, a trimmed copy of the existing transparent `futureino-logo.png`) + “Smart Vending Kiosk”, inline EN/ES/FR/HE/AF chips top-right (same `chooseLanguage`; the old dropdown `LanguageButton` is gone). Center: glowing **Tap or Speak** orb with mic, hint line, and a transcript card (idle example copy / last `heard` + `say`) over a thin decorative waveform. Below: “Demo — choose a machine” label and two whole-card buttons (Boost Coffee / Snacks Bot: photo, title, localized short blurb, Start Order pill). Footer: noisy-area tip (tap the mic or use touch) and a status strip “Voice + touch | Unit {NEXT_PUBLIC_UNIT_ID or DEMO-01} | lang”. Cards stack at ≤340px. Reduced motion disables halo, ripple, wave, and card animations.

**Behaviour:** The orb never opens the mic on Attract and never selects a machine. An early tap shows “Pick a machine below” in the transcript card for ~3s, pulses both cards, and scrolls them into view. Whole card / Start Order → `onSelectMachine` → Engineer’s `beginFromMachine` (optimistic menu, welcome from prefetch, listening once the session is live), unchanged. No wake word: the example line is idle copy only, and “Voice + touch” is a capability label, not a live-mic claim.

**Alternatives:** Orb starts Attract STT (`/api/arrive` picks a machine from speech). Orb mirrors a default machine pick. Keep the white Attract.

**Why:** Matches the new home design while respecting the Engineer lock: no STT before a machine is chosen, and one real start path. The demo label keeps the two-machine picker honest as demo chrome.

**How we checked:** `npm run typecheck` and `npm test` (70/70). Static HTML harness screenshots at 430 framed / 390 / 320 / RTL.

## 2026-10-05 — Dark Menu catalogue restyle (cyan + ADD pills)

**Decided:** Restyle Menu (and shared chrome tokens) to match the dark Attract language while locking Engineer wires. Menu wraps in `.menuView`: Futureino mark + machine title, chat bubble with YOU (heard) / MACHINE (say) tags (not a wake gate), dark product cards with hero image / name / price, and a cyan gradient pill — **ADD** when `!requiresTemperature` (snacks), **ADD / CUSTOM** when `requiresTemperature` (coffee) — both still call `onPick` → existing ProductSheet / temp picker. Spotlight (`spotlightIds` + `.spot`) uses a strong cyan glow border. Talk + listening `VoiceLine` circle stay in the dock beside Talk; cart dock / opening skeleton / one-machine catalog / welcome path unchanged. Shared `.screen` tokens go dark charcoal + cyan so Review / Pay / sheet / composer do not flash paper-white; no invented kcal or allergen claims.

**Alternatives:** Keep light Menu under dark Attract. Whole-card tap without ADD pills. Duplicate a second catalog grid.

**Why:** Visual match to the catalogue reference without reopening dual-machine tabs or breaking onPick / onToggleTalk / opening / cart.

**How we checked:** `npm run typecheck`. ADD vs ADD/CUSTOM maps from `CatalogItem.requiresTemperature`.

## 2026-10-05 — Dark Pay restyle (display-only tax + chrome payment tiles)

**Decided:** Restyle Pay to match dark Menu/Attract. Header: Futureino logo + YOU/MACHINE chat (`Reply`). Body: **YOUR CART (N items)** lines as name · temp (if any) · qty · price — no Medium/sugar fields we do not store. Breakdown shows Subtotal, Tax, and a **TOTAL DUE** bar. **SELECT PAYMENT METHOD** offers three chrome tiles (Credit/Debit default, Mobile Pay, Loyalty/Prepaid) with local UI selection only — no payment processor. Dock keeps “Say Confirm and Pay”, Talk/mic + listening meter, unit id (`NEXT_PUBLIC_UNIT_ID` or `DEMO-01`), Composer, and Back / Change order / New order handlers.

**Tax (Engineer lock):** Demo display-only split — `taxCents = Math.round(totalCents * 0.08)`, `subtotalCents = totalCents - taxCents`, **TOTAL DUE = `readBack.totalCents`** (catalog / operator truth). Tax is chrome only; cost accounting is unchanged.

**Alternatives:** Tax $0.00 with TOTAL = cart sum. Real payment processor. Invent size/sugar fields from the mock.

**Why:** Matches the Pay reference without charging or rewriting the order total the engine already confirmed.

**How we checked:** `npm run typecheck`.

## 2026-10-05 — Pure conversation default; Expand reveals touch CTAs

**Decided:** Menu, Review, and Pay default to conversation chrome: Talk + YOU/MACHINE chat (+ listening circle) always visible; one local `controlsOpen` flag (default false) stays open until the user collapses it. Bottom **Expand** / **Collapse** toggles the panel. Behind Expand: Composer / type-instead, Back / Change / New / Review CTAs, voice tips, and Menu cart qty / temp / remove controls. Pay payment tiles stay visible; Confirm/Change/New (and Composer / say-confirm hint) sit behind Expand. Attract unchanged. Mic-fail notices still show; Expand is never gated on Talk/mic. Layout + CSS only — no handler rewrites.

**Alternatives:** Keep all touch CTAs always visible. Auto-open Expand on mic-fail or missing temp. Shared `controlsOpen` lifted to `Kiosk` across screens.

**Why:** Voice-first ordering should read as talk, not a wall of buttons. Expand keeps touch escape hatches (including when the mic is blocked) without changing order/engine wiring.

**How we checked:** `npm run typecheck`. Menu/Review/Pay show Expand by default; Collapse hides CTAs; Pay tiles remain; Attract untouched.
