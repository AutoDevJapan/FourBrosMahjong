import { createOnlineServer } from "./index";
import { parseOnlineServerPort } from "./port";
import type { ShutdownSignal } from "./shutdownController";

const server = createOnlineServer({
  onShutdownEvent(event) {
    // Fixed process lifecycle evidence only: no room, player, token, or source.
    console.log(JSON.stringify({ event }));
  },
});

let signalCount = 0;
let shutdownPromise: Promise<void> | null = null;

function handleSignal(signal: ShutdownSignal): void {
  signalCount += 1;
  console.log(
    JSON.stringify({
      event: "shutdown-signal-received",
      signal,
      ordinal: signalCount,
    }),
  );
  shutdownPromise = server.handleSignal(signal);
  void shutdownPromise.catch(() => {
    // The controller has already attempted bounded force cleanup. Preserve a
    // non-zero natural exit without racing resources through process.exit().
    process.exitCode = 1;
    console.error(JSON.stringify({ event: "shutdown-cleanup-failed" }));
  });
}

async function main(): Promise<void> {
  process.on("SIGTERM", handleSignal);
  process.on("SIGINT", handleSignal);

  try {
    await server.listen(parseOnlineServerPort(process.env.PORT));
    if (
      shutdownPromise === null &&
      !server.shutdownController.state().started
    ) {
      const address = server.httpServer.address();
      const port =
        address !== null && typeof address === "object" ? address.port : null;
      console.log(
        JSON.stringify({
          event: "online-server-listening",
          port,
        }),
      );
    } else {
      await shutdownPromise?.catch(() => undefined);
    }
  } catch {
    if (shutdownPromise === null) {
      process.exitCode = 1;
      console.error(JSON.stringify({ event: "online-server-start-failed" }));
      // A failed listen leaves no useful service, but still route cleanup through
      // the same bounded controller rather than calling process.exit().
      handleSignal("SIGTERM");
    } else {
      // A signal won the startup race. Its existing promise owns cleanup; do not
      // synthesize a second signal or print a misleading listening event.
      await shutdownPromise.catch(() => undefined);
    }
  }
}

void main().catch(() => {
  // All expected startup and shutdown failures are handled above. Keep an
  // unexpected entrypoint failure from becoming an unhandled rejection while
  // preserving natural resource cleanup.
  process.exitCode = 1;
});
