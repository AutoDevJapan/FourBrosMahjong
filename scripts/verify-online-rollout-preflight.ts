import { stdin, stdout } from "node:process";
import { validateOnlineRolloutPreflight } from "../server/rolloutPreflight";
import { parseStrictJson } from "./strictJson";

const MAX_INPUT_BYTES = 64 * 1_024;

async function readBoundedStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_INPUT_BYTES) {
      throw new RangeError("rollout preflight input is too large");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  let evidence: unknown = null;
  try {
    evidence = parseStrictJson(await readBoundedStdin());
  } catch {
    // Parse, encoding, and size failures intentionally share the same fixed,
    // non-reflective result as all other schema failures.
  }
  const result = validateOnlineRolloutPreflight(evidence);
  stdout.write(`${JSON.stringify(result)}\n`);
  if (result.repoPreflight !== "pass") process.exitCode = 1;
}

void main();
