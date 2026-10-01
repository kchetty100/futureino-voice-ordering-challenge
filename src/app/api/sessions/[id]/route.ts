import { commandSession } from "../../../../session/store";
import type { OrderInput } from "../../../../order/engine";

const COMMANDS = new Set([
  "add",
  "set_temperature",
  "set_quantity",
  "remove_line",
  "read_back",
  "confirm",
  "revise",
  "activity",
  "cancel",
  "tick",
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const command = (await request.json()) as OrderInput;
  if (!command || typeof command.type !== "string" || !COMMANDS.has(command.type)) {
    return Response.json({ error: "Unknown command." }, { status: 400 });
  }
  const response = await commandSession(id, command);
  if (!response) return Response.json({ error: "Unknown session." }, { status: 404 });
  return Response.json(response);
}
