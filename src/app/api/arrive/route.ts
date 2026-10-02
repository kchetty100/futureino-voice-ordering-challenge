import { wakeSay } from "../../../agent/arrive";
import { parseNavIntent } from "../../../agent/nav";
import { isPromptEcho, speechPrompt } from "../../../catalog/index";
import { detectLanguage, isAppLanguage, languageFromSttLabel, t, type AppLanguage } from "../../../i18n";
import { claimSpeech, speechBudgetDenied, speechClientIp } from "../../../operator/budget";
import { beginLobby, noteUsageFor, recordTurn, saveRecord } from "../../../operator/log";
import { arriveSession } from "../../../session/store";
import { transcribe } from "../../../speech/openai";
import { issueSpeakTicket } from "../../../speech/ticket";

const MAX_AUDIO_BYTES = 2_000_000;
const PROMPT = speechPrompt();

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let text = "";
  let usage: Awaited<ReturnType<typeof transcribe>>["usage"] | null = null;
  let sttLanguageLabel: string | null = null;
  let spoken = contentType.includes("application/json") ? ("text" as const) : ("voice" as const);
  let wake = false;
  let pinnedLanguage: AppLanguage | null = null;
  if (contentType.includes("application/json")) {
    const body = (await request.json()) as { text?: string; language?: string };
    text = body.text?.trim() ?? "";
    pinnedLanguage = isAppLanguage(body.language) ? body.language : null;
    if (process.env.OPENAI_API_KEY && !(await claimSpeech(speechClientIp(request)))) return speechBudgetDenied();
  } else {
    if (!process.env.OPENAI_API_KEY) return Response.json({ error: "Speech is not configured." }, { status: 503 });
    const form = await request.formData();
    wake = form.get("intent") === "wake";
    const chosen = form.get("language");
    pinnedLanguage = isAppLanguage(chosen) ? chosen : null;
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) return Response.json({ error: "No audio." }, { status: 400 });
    if (audio.size > MAX_AUDIO_BYTES) return Response.json({ error: "That recording is too long." }, { status: 413 });
    if (!(await claimSpeech(speechClientIp(request)))) return speechBudgetDenied();
    try {
      const heard = await transcribe(audio, PROMPT, clipSeconds(form), pinnedLanguage);
      text = isPromptEcho(heard.text, PROMPT) ? "" : heard.text;
      usage = heard.usage;
      sttLanguageLabel = heard.detectedLanguage;
    } catch (error) {
      console.error("Transcription failed.", error instanceof Error ? error.message : "unknown error");
      return Response.json({ error: "Speech didn't come through." }, { status: 502 });
    }
  }

  if (wake) {
    const lang = pinnedLanguage ?? languageFromSttLabel(sttLanguageLabel) ?? detectLanguage(text) ?? "en";
    const say = wakeSay(text, lang);
    return Response.json({
      session: null,
      readBack: null,
      say,
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui: null,
      transcript: text,
      speakTicket: issueSpeakTicket(say, null, lang),
    });
  }

  const nav = parseNavIntent(text);
  if (nav) {
    const lang = detectLanguage(text) ?? languageFromSttLabel(sttLanguageLabel) ?? "en";
    const ui = nav.kind === "ui" ? nav.ui : null;
    const say =
      nav.kind === "clear_cart" || ui === "open_cart"
        ? t(lang, "cart_empty")
        : ui === "scroll_up" || ui === "scroll_down"
          ? t(lang, "open_menu_first")
          : t(lang, "going_back");
    return Response.json({
      session: null,
      readBack: null,
      say,
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui,
      transcript: text,
      speakTicket: issueSpeakTicket(say, null, lang),
    });
  }

  if (!text) {
    const now = Date.now();
    const logId = beginLobby(now);
    const lang = languageFromSttLabel(sttLanguageLabel) ?? "en";
    const miss = t(lang, "didnt_catch");
    recordTurn(logId, { at: now, source: spoken, customer: null, say: miss });
    if (usage) noteUsageFor(logId, usage);
    await saveRecord(logId);
    return Response.json({
      session: null,
      readBack: null,
      say: miss,
      notice: null,
      spotlightIds: [],
      switchTo: null,
      ui: null,
      transcript: "",
      speakTicket: null,
    });
  }

  const arrived = await arriveSession(text, Date.now(), spoken, sttLanguageLabel, pinnedLanguage);
  if (usage) {
    noteUsageFor(arrived.logId, usage);
    await saveRecord(arrived.logId);
  }
  const speakLang =
    (arrived.session && arrived.session.preferredLanguage) ||
    languageFromSttLabel(sttLanguageLabel) ||
    detectLanguage(text) ||
    "en";
  const { logId: _logId, ...response } = arrived;
  return Response.json({
    ...response,
    transcript: text,
    speakTicket: issueSpeakTicket(arrived.say, arrived.session?.id ?? arrived.logId, speakLang),
  });
}

function clipSeconds(form: FormData): number {
  const raw = Number(form.get("seconds"));
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return Math.min(raw, 30);
}
