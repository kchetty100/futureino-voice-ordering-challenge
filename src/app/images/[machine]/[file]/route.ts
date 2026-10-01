import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.join(process.cwd(), "images");

export async function GET(
  _request: Request,
  context: { params: Promise<{ machine: string; file: string }> },
) {
  const { machine, file } = await context.params;
  if (machine !== "coffee" && machine !== "snacks") {
    return new Response("Not found", { status: 404 });
  }
  if (!/^[a-z0-9-]+\.webp$/.test(file)) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(path.join(ROOT, machine, file));
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
