import { isAppLanguage } from "../../../../../i18n";
import { claimSpeech, speechBudgetDenied, speechClientIp } from "../../../../../operator/budget";
import { assignLanguage, messageSession } from "../../../../../session/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { text?: string; language?: string };
  const text = body.text?.trim() ?? "";
  if (!text) return Response.json({ error: "Say what you want." }, { status: 400 });
  if (process.env.OPENAI_API_KEY && !(await claimSpeech(speechClientIp(request)))) return speechBudgetDenied();
  if (isAppLanguage(body.language)) await assignLanguage(id, body.language);
  const response = await messageSession(id, text);
  if (!response) return Response.json({ error: "Unknown session." }, { status: 404 });
  return Response.json(response);
}
