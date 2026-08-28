import { stdin } from "node:process";
import { isValidOpsToken, ONLINE_OPS_TOKEN_MAX_BYTES } from "../server/opsAuth";

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > ONLINE_OPS_TOKEN_MAX_BYTES) {
      process.exitCode = 1;
      return;
    }
    chunks.push(buffer);
  }
  if (!isValidOpsToken(Buffer.concat(chunks).toString("utf8"))) {
    process.exitCode = 1;
  }
}

void main();
