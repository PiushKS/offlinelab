import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");

export interface DemoNoteRecord {
  id: string;
  title: string;
  body: string;
  version: number;
  updatedAt: number;
  idempotencyKey?: string;
}

export interface DemoBackendFaultConfig {
  delayMs: number;
  failNextCount: number;
  failStatus: number;
  dropResponseAfterPersist: boolean;
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

export interface DemoAppServerHandle {
  url: string;
  port: number;
  close: () => Promise<void>;
  reset: () => void;
  getRecords: () => DemoNoteRecord[];
  getStats: () => {
    recordCount: number;
    postAttempts: number;
    deduplicatedCount: number;
    records: DemoNoteRecord[];
  };
  configureFaults: (cfg: Partial<DemoBackendFaultConfig>) => void;
}

export async function startDemoAppServer(port = 0): Promise<DemoAppServerHandle> {
  const records = new Map<string, DemoNoteRecord>();
  const idempotencyMap = new Map<string, DemoNoteRecord>();
  let postAttempts = 0;
  let deduplicatedCount = 0;
  let faultConfig: DemoBackendFaultConfig = {
    delayMs: 0,
    failNextCount: 0,
    failStatus: 503,
    dropResponseAfterPersist: false,
  };

  const reset = () => {
    records.clear();
    idempotencyMap.clear();
    postAttempts = 0;
    deduplicatedCount = 0;
    faultConfig = {
      delayMs: 0,
      failNextCount: 0,
      failStatus: 503,
      dropResponseAfterPersist: false,
    };
  };

  const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const pathname = reqUrl.pathname;

    // Control endpoints for deterministic testing
    if (pathname === "/api/control/reset" && req.method === "POST") {
      reset();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === "/api/control/config" && req.method === "POST") {
      const body = await readJsonBody(req);
      faultConfig = {
        ...faultConfig,
        ...(typeof body.delayMs === "number" ? { delayMs: body.delayMs } : {}),
        ...(typeof body.failNextCount === "number" ? { failNextCount: body.failNextCount } : {}),
        ...(typeof body.failStatus === "number" ? { failStatus: body.failStatus } : {}),
        ...(typeof body.dropResponseAfterPersist === "boolean"
          ? { dropResponseAfterPersist: body.dropResponseAfterPersist }
          : {}),
      };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, faultConfig }));
      return;
    }

    if (pathname === "/api/control/stats" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          recordCount: records.size,
          postAttempts,
          deduplicatedCount,
          records: Array.from(records.values()),
        }),
      );
      return;
    }

    // Notes REST API
    if (pathname === "/api/notes" && req.method === "GET") {
      if (faultConfig.delayMs > 0) {
        await new Promise((r) => setTimeout(r, faultConfig.delayMs));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ records: Array.from(records.values()) }));
      return;
    }

    if (pathname === "/api/notes" && req.method === "POST") {
      postAttempts += 1;

      if (faultConfig.delayMs > 0) {
        await new Promise((r) => setTimeout(r, faultConfig.delayMs));
      }

      if (faultConfig.failNextCount > 0) {
        faultConfig.failNextCount -= 1;
        res.writeHead(faultConfig.failStatus, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: `Simulated backend HTTP ${faultConfig.failStatus}` }));
        return;
      }

      const body = await readJsonBody(req);
      const idempotencyKey =
        typeof req.headers["idempotency-key"] === "string"
          ? req.headers["idempotency-key"]
          : undefined;

      if (idempotencyKey && idempotencyMap.has(idempotencyKey)) {
        deduplicatedCount += 1;
        const existing = idempotencyMap.get(idempotencyKey)!;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ record: existing, deduplicated: true }));
        return;
      }

      const id =
        typeof body.id === "string" && body.id.trim().length > 0
          ? body.id
          : `srv_${Date.now().toString(36)}_${records.size + 1}`;
      const title = typeof body.title === "string" ? body.title : "";
      const noteBody = typeof body.body === "string" ? body.body : "";
      const baseVersion = typeof body.baseVersion === "number" ? body.baseVersion : 0;

      const existingById = records.get(id);
      if (existingById && existingById.version !== baseVersion) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Version conflict",
            serverRecord: existingById,
          }),
        );
        return;
      }

      const record: DemoNoteRecord = {
        id,
        title,
        body: noteBody,
        version: existingById ? existingById.version + 1 : 1,
        updatedAt: Date.now(),
        idempotencyKey,
      };
      records.set(id, record);
      if (idempotencyKey) {
        idempotencyMap.set(idempotencyKey, record);
      }

      // Simulate server persistence succeeded, but response connection dropped mid-stream before client received the payload!
      if (faultConfig.dropResponseAfterPersist) {
        faultConfig.dropResponseAfterPersist = false;
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": "4096",
          Connection: "close",
        });
        res.write('{"partial":');
        setTimeout(() => {
          req.socket.destroy();
        }, 10);
        return;
      }

      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ record, deduplicated: false }));
      return;
    }

    // Static file serving
    const safeRel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const resolved = path.resolve(PUBLIC_DIR, safeRel);
    if (!resolved.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const content = await fs.readFile(resolved);
      const ext = path.extname(resolved).toLowerCase();
      const headers: Record<string, string> = {
        "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": ext === ".js" && safeRel === "sw.js" ? "no-cache" : "public, max-age=0",
      };
      if (safeRel === "sw.js") {
        headers["Service-Worker-Allowed"] = "/";
      }
      res.writeHead(200, headers);
      res.end(content);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  const url = `http://localhost:${actualPort}`;

  return {
    url,
    port: actualPort,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    },
    reset,
    getRecords: () => Array.from(records.values()),
    getStats: () => ({
      recordCount: records.size,
      postAttempts,
      deduplicatedCount,
      records: Array.from(records.values()),
    }),
    configureFaults: (cfg) => {
      faultConfig = { ...faultConfig, ...cfg };
    },
  };
}

// Allow running standalone: `node fixtures/offline-demo-app/server.ts` (Node 22+ strip-types)
const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const desiredPort = Number(process.env.PORT ?? "4173");
  startDemoAppServer(desiredPort).then((handle) => {
    console.log(`OfflineLab Demo PWA listening on ${handle.url}`);
  });
}
