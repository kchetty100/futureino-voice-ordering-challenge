import { readFile } from "node:fs/promises";
import path from "node:path";

const TYPES: Record<string, string> = {
  "futureino-logo-trimmed.png": "image/png",
  "futureino-logo-trimmed.webp": "image/webp",
  "futureino-logo.png": "image/png",
  "futureino-logo-clear.png": "image/png",
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ file: string }> },
) {
  const { file } = await context.params;
  const contentType = TYPES[file];
  if (!contentType) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(path.join(process.cwd(), "brand", file));
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
