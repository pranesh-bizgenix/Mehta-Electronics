import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 4173);
const coreUrl = process.env.GI_CORE_URL || "http://127.0.0.1:3122";
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);

  if (pathname === "/api/live-brief") {
    try {
      const upstream = await fetch(`${coreUrl}/api/cockpit`, {
        headers: {
          accept: "application/json",
          cookie: request.headers.cookie || "",
        },
      });
      const body = await upstream.arrayBuffer();
      response.writeHead(upstream.status, {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(Buffer.from(body));
    } catch {
      response.writeHead(502, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      response.end(JSON.stringify({
        ok: false,
        mode: "offline",
        message: `GI core is not running at ${coreUrl}. Start it to read connected Tally data.`,
      }));
    }
    return;
  }

  if (pathname === "/connect-tally") {
    response.writeHead(302, { location: `${coreUrl}/connections`, "cache-control": "no-store" });
    response.end();
    return;
  }

  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = normalize(join(root, relative));
  if (!candidate.startsWith(root) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "content-type": types[extname(candidate)] || "application/octet-stream", "cache-control": "no-store" });
  createReadStream(candidate).pipe(response);
}).listen(port, "127.0.0.1", () => {
  console.log(`Growth Intelligence prototype: http://127.0.0.1:${port}`);
});
