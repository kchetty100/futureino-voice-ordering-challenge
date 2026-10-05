import { getItem } from "../../../../../catalog/index";
import { langOf, t } from "../../../../../i18n";
import { money } from "../../../../../agent/tools";
import { buildReadBack } from "../../../../../order/engine";
import { peekSession } from "../../../../../session/store";
import { issueSpeakTicket } from "../../../../../speech/ticket";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const session = await peekSession(id);
  if (!session) return Response.json({ error: "Unknown session." }, { status: 404 });

  if (session.phase !== "awaiting_confirmation") {
    return Response.json({ error: "not_awaiting_confirmation" }, { status: 400 });
  }

  const incomplete =
    session.lines.length === 0 ||
    session.lines.some(
      (line) => getItem(line.productId)?.requiresTemperature === true && line.temperature === undefined,
    );
  if (incomplete) return Response.json({ error: "incomplete" }, { status: 400 });

  const readBack = buildReadBack(session);
  const say = t(langOf(session), "ready_to_pay", { total: money(readBack.totalCents) });
  const speakTicket = issueSpeakTicket(say, id, langOf(session));
  return Response.json({ say, speakTicket, cartVersion: session.cartVersion });
}
