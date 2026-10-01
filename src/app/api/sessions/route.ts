import { openSession } from "../../../session/store";

export async function POST(request: Request) {
  const body = (await request.json()) as { machineId?: string };
  if (body.machineId !== "coffee" && body.machineId !== "snacks") {
    return Response.json({ error: "Unknown machine." }, { status: 400 });
  }
  return Response.json(openSession(body.machineId));
}
