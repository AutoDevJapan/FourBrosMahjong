"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import {
  connectDisplayPort,
  type DisplayPort,
} from "@/domain/display/displayPort";
import { useGame } from "./GameProvider";

export interface DisplayHostFailure {
  readonly stage: "create" | "connect" | "publish" | "unsubscribe" | "dispose";
  readonly error: unknown;
}

type Binding = ReturnType<typeof connectDisplayPort>;

/**
 * React host boundary; no renderer is mounted by the existing 2D board.
 * Keep createPort stable and return a fresh owned port on every setup.
 * null disables the optional display. Failures close that connection and are
 * reported without stopping 2D; retry requires a new factory or a remount.
 */
export function useLocalDisplayPort(
  createPort: (() => DisplayPort) | null,
  onError: (failure: DisplayHostFailure) => void,
): void {
  const context = useGame();
  const supported =
    context.displaySource !== undefined &&
    context.readDisplaySource !== undefined;
  const committed = useRef(context);
  const errorHandler = useRef(onError);
  const connection = useRef<Binding | null>(null);

  useLayoutEffect(() => {
    committed.current = context;
    errorHandler.current = onError;
  }, [context, onError]);

  const report = useCallback(
    (stage: DisplayHostFailure["stage"], error: unknown) => {
      const failure = { stage, error };
      try {
        errorHandler.current(failure);
      } catch (reportingError) {
        // A broken display error reporter must not tear down the 2D provider.
        // Both errors remain observable; this is not a silent fallback/retry.
        console.error(
          "Local display error reporting failed",
          failure,
          reportingError,
        );
      }
    },
    [],
  );

  const close = useCallback(
    (binding: Binding) => {
      if (connection.current === binding) connection.current = null;
      void binding
        .dispose()
        .catch((error: unknown) => report("dispose", error));
    },
    [report],
  );

  const refresh = useCallback(() => {
    const binding = connection.current;
    if (!binding) return;
    try {
      binding.refresh();
    } catch (error) {
      close(binding);
      report("publish", error);
    }
  }, [close, report]);

  // A renderer can unmount independently while its Provider stays active.
  // Close the binding synchronously before the passive-cleanup gap; dispose
  // marks its callbacks closed before releasing/awaiting transport resources.
  useLayoutEffect(
    () => () => {
      if (connection.current) close(connection.current);
    },
    [createPort, supported, close],
  );

  // Child passive effects run after all Provider layout setups, including
  // StrictMode's cleanup/setup cycle. Never connect from a child layout effect.
  useEffect(() => {
    if (!createPort || !supported) return;
    let port: DisplayPort;
    try {
      port = createPort();
    } catch (error) {
      report("create", error);
      return;
    }
    let binding: Binding;
    try {
      binding = connectDisplayPort(
        {
          publish: (frame) => port.publish(frame),
          onIntent: (listener) => {
            const unsubscribe = port.onIntent(listener);
            return () => {
              try {
                unsubscribe();
              } catch (error) {
                // Observe this independently: a later dispose rejection must
                // not mask the unsubscribe failure in the binding's finally.
                report("unsubscribe", error);
              }
            };
          },
          dispose: () => port.dispose(),
        },
        () => committed.current,
      );
    } catch (error) {
      // A failed subscription may already have allocated transport resources.
      // With no binding returned, ownership still belongs to this host.
      report("connect", error);
      try {
        void Promise.resolve(port.dispose()).catch((disposeError: unknown) =>
          report("dispose", disposeError),
        );
      } catch (disposeError) {
        report("dispose", disposeError);
      }
      return;
    }
    connection.current = binding;
    refresh();
    return () => close(binding);
  }, [createPort, supported, close, refresh, report]);

  useEffect(() => refresh(), [context, refresh]);
}
