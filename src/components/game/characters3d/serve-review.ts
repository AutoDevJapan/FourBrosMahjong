/** Independent static review server. Does not start Next or touch .next. */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { MODEL_PROFILES } from "./profiles";
import { readCharacterTextureSet } from "./texture-supply";

async function main() {
  if (!process.env.CHARACTER_REVIEW_OUTPUT)
    throw new Error("Set CHARACTER_REVIEW_OUTPUT to the artifact directory");
  const output = resolve(process.env.CHARACTER_REVIEW_OUTPUT ?? ""),
    r = createRequire(import.meta.url);
  const esbuild = createRequire(r.resolve("tsx/package.json"))("esbuild");
  const textures = await readCharacterTextureSet();
  const assets = new Map<string, Buffer>();
  for (const [id, supplied] of textures) {
    assets.set(
      `/src/components/game/characters3d/textures/${id}-reference.jpg`,
      supplied.texture,
    );
    assets.set(
      `/documents/assets/characters/originals/${MODEL_PROFILES[id].source}`,
      supplied.source,
    );
  }
  await mkdir(output, { recursive: true });
  await esbuild.build({
    entryPoints: ["src/components/game/characters3d/review-viewer.ts"],
    outfile: join(output, "viewer.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
  });
  const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><title>四兄弟3D 原本比較（未承認候補）</title><style>
body{margin:0;padding:16px;background:#f6f7f8;color:#18212c;font:16px sans-serif}h1{font-size:24px;margin:0 0 8px}p{margin:0 0 14px}nav{display:flex;gap:20px;margin:10px 0}button,select{font-size:16px;padding:5px}#labels,#sources{display:grid;grid-template-columns:repeat(4,1fr)}#labels span{padding:8px;background:#dce4e9}#sources{padding:6px 0}.source{height:240px;background:white;display:flex;justify-content:center}.crop{position:relative;overflow:hidden;width:68px;height:240px}.source img{position:absolute;top:-34px;height:317px;width:auto}canvas{display:block;width:1440px;height:560px;max-width:100%;border:1px solid #aebbc4}output{display:block;padding:10px 0;font:14px monospace}</style><main id="review"></main><script src="/viewer.js"></script></html>`;
  await writeFile(join(output, "viewer.html"), html);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"),
        name = decodeURIComponent(url.pathname);
      if (name === "/" || name === "/viewer.html") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(html);
        return;
      }
      const bytes =
        name === "/viewer.js"
          ? await readFile(join(output, "viewer.js"))
          : assets.get(name);
      if (!bytes) {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader(
        "Content-Type",
        name.endsWith(".js")
          ? "text/javascript"
          : name.endsWith(".jpg")
            ? "image/jpeg"
            : "image/png",
      );
      res.end(bytes);
    } catch {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(43196, "127.0.0.1", () =>
    console.log(
      "character-review http://127.0.0.1:43196 (static; no Next server)",
    ),
  );
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
