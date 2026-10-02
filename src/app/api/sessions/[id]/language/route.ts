import { isAppLanguage } from "../../../../../i18n";
import { assignLanguage } from "../../../../../session/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = (await request.json()) as { language?: string };
  if (!isAppLanguage(body.language)) return Response.json({ error: "Unknown language." }, { status: 400 });
  const response = await assignLanguage(id, body.language);
  if (!response) return Response.json({ error: "Unknown session." }, { status: 404 });
  return Response.json(response);
}
