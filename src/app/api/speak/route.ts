import { loadRecord, noteUsageFor, saveRecord } from "../../../operator/log";
import { synthesize } from "../../../speech/openai";
import { claimSpeakTicket } from "../../../speech/ticket";

/** Speak the line the order response already showed. The bytes are audio, not a JSON field. */
export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Speech is not configured." }, { status: 503 });
  }
  const body = (await request.json().catch(() => null)) as { say?: string; ticket?: string } | null;
  const say = body?.say ?? "";
  const ticket = body?.ticket ?? "";
  const claimed = await claimSpeakTicket(say, ticket);
  if (!claimed.ok) return Response.json({ error: "That line can't be spoken." }, { status: 403 });

  try {
    const spoken = await synthesize(say, claimed.language);
    if (!spoken) return Response.json({ error: "Nothing to say." }, { status: 400 });
    if (claimed.sessionId) {
      await loadRecord(claimed.sessionId);
      noteUsageFor(claimed.sessionId, spoken.usage);
      await saveRecord(claimed.sessionId);
    }
    return new Response(Buffer.from(spoken.bytes), {
      headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("Speech playback failed.", error instanceof Error ? error.message : "unknown error");
    return Response.json({ error: "Speech playback failed." }, { status: 502 });
  }
}
