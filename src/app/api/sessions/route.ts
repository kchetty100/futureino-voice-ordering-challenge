import { isAppLanguage } from "../../../i18n";
import { openSession } from "../../../session/store";

export async function POST(request: Request) {
  const body = (await request.json()) as { machineId?: string; language?: string };
  if (body.machineId !== "coffee" && body.machineId !== "snacks") {
    return Response.json({ error: "Unknown machine." }, { status: 400 });
  }
  const language = isAppLanguage(body.language) ? { preferredLanguage: body.language, languageSet: true as const } : undefined;
  return Response.json(await openSession(body.machineId, Date.now(), language));
}
