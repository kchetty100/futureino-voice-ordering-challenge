import { getItem, isPromptEcho, speechPrompt } from "../../../../../catalog/index";
import { isAppLanguage, langOf, languageFromSttLabel, t } from "../../../../../i18n";
import { claimSpeech, speechBudgetDenied, speechClientIp } from "../../../../../operator/budget";
import { loadRecord, noteUsageFor, recordTurn, saveRecord } from "../../../../../operator/log";
import { assignLanguage, commandSession, messageSession, recallLanguage, sessionMachine } from "../../../../../session/store";
import { lineToSpeak } from "../../../../../speech/line";
import { synthesize, transcribe } from "../../../../../speech/openai";

const MAX_AUDIO_BYTES = 2_000_000;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Speech is not configured." }, { status: 503 });
  }

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size === 0) {
    return Response.json({ error: "No audio." }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: "That recording is too long." }, { status: 413 });
  }
  if (!(await claimSpeech(speechClientIp(request)))) return speechBudgetDenied();

  if (!(await sessionMachine(id))) return Response.json({ error: "Unknown session." }, { status: 404 });
  const requested = form.get("language");
  if (isAppLanguage(requested)) await assignLanguage(id, requested);
  const prompt = speechPrompt();
  const knownLanguage = await recallLanguage(id);

  let transcript = "";
  let usage: Awaited<ReturnType<typeof transcribe>>["usage"] | null = null;
  let sttLanguageLabel: string | null = null;
  try {
    const heard = await transcribe(audio, prompt, clipSeconds(form), knownLanguage?.languageSet ? knownLanguage.preferredLanguage : null);
    transcript = isPromptEcho(heard.text, prompt) ? "" : heard.text;
    usage = heard.usage;
    sttLanguageLabel = heard.detectedLanguage;
  } catch (error) {
    console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Speech didn't come through." }, { status: 502 });
  }

  await loadRecord(id);
  noteUsageFor(id, usage);
  if (!transcript) {
    const quiet = await commandSession(id, { type: "activity" });
    if (!quiet) return Response.json({ error: "Unknown session." }, { status: 404 });
    const pending =
      quiet.session?.lines.filter(
        (line) => getItem(line.productId)?.requiresTemperature === true && line.temperature === undefined,
      ) ?? [];
    const lang = quiet.session ? langOf(quiet.session) : (knownLanguage?.preferredLanguage ?? languageFromSttLabel(sttLanguageLabel) ?? "en");
    const names = pending.map((line) => getItem(line.productId)?.name ?? "That drink");
    const listed = names.length === 1 ? (names[0] ?? "That drink") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
    const miss =
      names.length === 0
        ? t(lang, "didnt_catch")
        : t(lang, names.length === 1 ? "needs_temp" : "need_temps", { name: listed, names: listed });
    recordTurn(id, { at: Date.now(), source: "voice", customer: null, say: miss });
    await saveRecord(id);
    return Response.json({ ...quiet, say: miss, transcript: "", audioBase64: null });
  }

  await saveRecord(id);
  const response = await messageSession(id, transcript, Date.now(), "voice", sttLanguageLabel);
  if (!response) return Response.json({ error: "Unknown session." }, { status: 404 });

  let audioBase64: string | null = null;
  const line = lineToSpeak(response.say);
  if (line) {
    try {
      const speakLang = response.session ? langOf(response.session) : knownLanguage?.preferredLanguage;
      const spoken = await synthesize(line, speakLang);
      if (spoken) {
        noteUsageFor(id, spoken.usage);
        await saveRecord(id);
      }
      audioBase64 = spoken ? Buffer.from(spoken.bytes).toString("base64") : null;
    } catch (error) {
      console.error("Speech playback failed.", error instanceof Error ? error.message : "unknown error");
    }
  }

  return Response.json({ ...response, transcript, audioBase64 });
}

function clipSeconds(form: FormData): number {
  const raw = Number(form.get("seconds"));
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 30);
}
