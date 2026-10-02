# Write-up

## Run it

```bash
npm install
```

Put `OPENAI_API_KEY` and `OPERATOR_PASSWORD` in `.env`. That file stays off git. Then:

```bash
npm run dev
```

Open http://localhost:3000. The site sends you to `/enter`. The password is the operator password from `.env`, the same one that unlocks `/operator`. Without a speech key, the menu, the cart, and typed orders still run on the rules. Voice needs the key.

```bash
npm test
npm run typecheck
```

## Deployed

Production is https://futureino-voice-ordering-challenge.vercel.app, built from `main` on Vercel (Hobby). The repository is https://github.com/kchetty100/futureino-voice-ordering-challenge.

Sign in at `/enter`. The password is `OPERATOR_PASSWORD` on the Vercel project. It is not in this file. Send it with the submission. The same password opens the operator log at `/operator`.

Server env, production and preview:

- `OPENAI_API_KEY`
- `OPERATOR_PASSWORD`
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (the Vercel names `KV_REST_API_URL` and `KV_REST_API_TOKEN` are the same store)

The browser never receives the speech key or the password. The gate is an httpOnly cookie. Eight wrong passwords from one address in 15 minutes lock that address for the rest of the window. Speech calls are capped at 120 per address per hour and 800 for the whole site per UTC day. Past that, the kiosk says the machine is resting its voice. With Redis unset, both counts stay in the current process. On Vercel they are counted in Redis, so a second instance shares them.

## What a conversation costs

Rates are the published list prices, estimated in `src/operator/cost.ts` and shown on `/operator`.

- Understanding the order (`gpt-4o-mini`): $0.15 per million input tokens, $0.60 per million output tokens.
- Hearing (`gpt-4o-mini-transcribe`): about $0.003 per minute.
- Speaking (`gpt-4o-mini-tts`): about $0.015 per minute. The speech API does not return a usage object, so playback is estimated from the length of the sentence.

A short order (a few clips, a few spoken replies, one text pass) lands around a few cents. The OpenAI usage page for the key's account is the invoice. `/operator` is the per-order estimate.

## Known limitations

- Product matching is still mostly English names and a short alias list. The five reply languages do not each have a full menu vocabulary.
- A quiet room can still be heard as the wrong product name, and that name can still change the cart. A transcript of the speech hint is dropped, and so is a clip of the machine's own line. Nearby talk that is not an order leaves the cart alone. A one-letter miss of hot, cold, iced, or room is treated as that temperature.
- The face model is downloaded from a CDN in the browser. The video stays on the device. With nobody in frame, the one-minute countdown starts after 10 seconds. With the camera blocked, still starting, or face detection not loaded, that countdown starts after three quiet minutes. A tap, a spoken turn, or a face clears it. The home screen does not count down.
- Operator records in Redis expire after 7 days.
- The order call returns the cart and the on-screen line before any audio. The voice is a second request, signed for that exact line and usable once. Hobby can still cut off the hearing call, or the extra text pass on an unclear sentence.
- Payment is out of scope. The flow stops at pay.

## What I would do next

- Add product phrases for Spanish, French, Hebrew, and Afrikaans so a named drink does not depend on the English menu model.
- Stream the reply so the first words start before the whole clip is synthesized.
- Use a real usage object for playback if the speech API starts returning one.
- Move the host to a plan with a longer function limit if a noisy mall makes turns time out.

## Tools

The kiosk was built in Cursor with its coding agent. The running product calls OpenAI for transcription, a short text pass when the rules do not already know the sentence, and speech playback. The on-screen line and the spoken line are the same text.
