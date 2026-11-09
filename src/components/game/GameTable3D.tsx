"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  DisplayIntent,
  DisplayPort,
  IntentReceipt,
} from "@/domain/display/displayPort";
import type {
  DisplayEnvelope,
  DisplayOption,
} from "@/domain/display/displaySnapshot";
import { tileLabel } from "../common/tileLabel";
import { createCharacterController } from "./characters3d";
import { CHARACTER_TEXTURES } from "./three/characterAssets";
import { projectCharacterSurfaces } from "./three/characterScene";
import { createMahjongRenderer } from "./three/mahjongRenderer";
import { useLocalDisplayPort } from "./useLocalDisplayPort";

export type TableDisplayStatus = "loading" | "ready" | "failed";

interface Selection {
  readonly frame: DisplayEnvelope;
  readonly option: DisplayOption & {
    readonly tile: {
      readonly suit: "man" | "pin" | "sou" | "honor";
      readonly rank: number;
    };
  };
}

interface Props {
  readonly riichiArmed?: boolean;
  readonly interactionDisabled?: boolean;
  readonly onStatusChange?: (status: TableDisplayStatus) => void;
  readonly renderCharacters?: boolean;
}

/** The canvas consumes the public adapter; game state and legality stay in the provider. */
export default function GameTable3D({
  riichiArmed = false,
  interactionDisabled = false,
  onStatusChange,
  renderCharacters = false,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ riichiArmed, interactionDisabled, onStatusChange });
  const [status, setStatus] = useState<TableDisplayStatus>("loading");
  const [selection, setSelection] = useState<Selection | null>(null);
  const confirmRef = useRef<(() => void) | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    settings.current = { riichiArmed, interactionDisabled, onStatusChange };
  }, [riichiArmed, interactionDisabled, onStatusChange]);

  useLayoutEffect(() => {
    clearSelectionRef.current?.();
  }, [riichiArmed, interactionDisabled]);

  const changeStatus = useCallback((next: TableDisplayStatus) => {
    setStatus(next);
    settings.current.onStatusChange?.(next);
  }, []);
  const fail = useCallback(() => {
    confirmRef.current = null;
    setSelection(null);
    changeStatus("failed");
  }, [changeStatus]);

  const createPort = useCallback((): DisplayPort => {
    if (!canvas.current) throw new Error("3D canvas is unavailable");
    let closed = false;
    let failed = false;
    let released = false;
    let resourcesReleased = false;
    let frame: DisplayEnvelope | null = null;
    let selected: Selection | null = null;
    let listener: ((intent: unknown) => IntentReceipt) | null = null;
    let request = 0;
    let runtime: ReturnType<typeof createMahjongRenderer> | undefined;
    let resizeObserver: ResizeObserver | undefined;
    const characterController = renderCharacters
      ? createCharacterController()
      : null;
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    let animation: number | null = null;
    let previousDraw = 0;
    const sampleCharacters = (now: number) => {
      if (!characterController || closed || failed || !runtime) return;
      try {
        runtime.setCharacters(
          projectCharacterSurfaces(
            characterController.sample(now, media?.matches ?? true),
          ),
        );
      } catch {
        failed = true;
        clearSelection();
        release();
        fail();
      }
    };
    const animate = (nowMs: number) => {
      animation = null;
      if (
        closed ||
        failed ||
        !characterController ||
        media?.matches ||
        document.hidden
      )
        return;
      if (nowMs - previousDraw >= 1000 / 24) {
        previousDraw = nowMs;
        // RAF timestamps describe the frame start and may precede a newer
        // provider publication. Sample the same monotonic clock as publish.
        sampleCharacters(performance.now() / 1000);
      }
      if (!closed && !failed) animation = requestAnimationFrame(animate);
    };
    const updateAnimation = () => {
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
      if (!characterController || closed || failed || !frame) return;
      sampleCharacters(performance.now() / 1000);
      if (!closed && !failed && !media?.matches && !document.hidden)
        animation = requestAnimationFrame(animate);
    };
    const resize = () => {
      if (!closed && !failed) runtime?.resize();
    };
    const release = () => {
      if (resourcesReleased) return;
      resourcesReleased = true;
      if (animation !== null) cancelAnimationFrame(animation);
      animation = null;
      media?.removeEventListener?.("change", updateAnimation);
      document.removeEventListener("visibilitychange", updateAnimation);
      characterController?.dispose();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      if (runtime && !released) {
        released = true;
        runtime.dispose();
      }
    };
    const clearSelection = () => {
      selected = null;
      confirmRef.current = null;
      setSelection(null);
      if (!released) runtime?.select?.(null);
    };
    const dispatch = (kind: DisplayIntent["kind"], choice: Selection) => {
      if (closed || failed || settings.current.interactionDisabled || !listener)
        return null;
      request += 1;
      return listener({
        protocol: choice.frame.protocol,
        version: choice.frame.version,
        kind,
        requestId: `canvas-${request}`,
        sessionId: choice.frame.sessionId,
        revision: choice.frame.revision,
        optionId: choice.option.id,
      });
    };
    clearSelectionRef.current = clearSelection;
    try {
      runtime = createMahjongRenderer(canvas.current, {
        characterTextures: renderCharacters ? CHARACTER_TEXTURES : undefined,
        onReady: () => {
          if (!closed && !failed) changeStatus("ready");
        },
        onError: () => {
          if (closed || failed) return;
          failed = true;
          clearSelection();
          release();
          fail();
        },
        onPick: (optionId: string) => {
          if (
            closed ||
            failed ||
            !frame ||
            settings.current.interactionDisabled
          )
            return;
          const picked = frame.snapshot.options.find(
            (option) => option.id === optionId,
          );
          if (!picked || !("tile" in picked)) {
            clearSelection();
            return;
          }
          const action = settings.current.riichiArmed ? "riichi" : "discard";
          const option = frame.snapshot.options.find(
            (candidate) =>
              "tile" in candidate &&
              candidate.action === action &&
              candidate.tile.suit === picked.tile.suit &&
              candidate.tile.rank === picked.tile.rank,
          );
          if (!option || !("tile" in option)) {
            clearSelection();
            return;
          }
          const choice = { frame, option };
          try {
            if (dispatch("select", choice)?.status !== "selected") {
              clearSelection();
              return;
            }
            selected = choice;
            setSelection(choice);
            runtime?.select?.(picked.id);
            confirmRef.current = () => {
              if (selected !== choice) return;
              // Invalidate before dispatch: rapid repeated activations cannot commit twice.
              selected = null;
              confirmRef.current = null;
              setSelection(null);
              try {
                dispatch("confirm", choice);
              } catch {
                failed = true;
                release();
                fail();
              } finally {
                if (!released) runtime?.select?.(null);
              }
            };
          } catch {
            failed = true;
            clearSelection();
            release();
            fail();
          }
        },
      });
      if (failed) release();
      else {
        window.addEventListener("resize", resize);
        if (typeof ResizeObserver !== "undefined") {
          resizeObserver = new ResizeObserver(resize);
          resizeObserver.observe(canvas.current);
        }
        media?.addEventListener?.("change", updateAnimation);
        document.addEventListener("visibilitychange", updateAnimation);
      }
    } catch (error) {
      release();
      throw error;
    }
    return {
      publish(next) {
        if (closed || failed) return;
        frame = next;
        clearSelection();
        runtime?.publish(next);
        if (characterController && !failed) {
          const roundKey = next.roundKey ?? "round-0";
          const now = performance.now() / 1000;
          characterController.publish(next, next.cues ?? [], roundKey, now);
          updateAnimation();
        }
      },
      onIntent(receive) {
        listener = receive;
        return () => {
          listener = null;
        };
      },
      dispose() {
        if (closed) return;
        closed = true;
        listener = null;
        frame = null;
        if (clearSelectionRef.current === clearSelection)
          clearSelectionRef.current = null;
        clearSelection();
        release();
      },
    };
  }, [changeStatus, fail, renderCharacters]);

  useLocalDisplayPort(status === "failed" ? null : createPort, fail);

  return (
    <div className="game-table-3d" data-3d-status={status}>
      <canvas
        ref={canvas}
        aria-hidden="true"
        className="game-table-3d-canvas"
      />
      {status === "loading" ? (
        <p className="game-table-3d-notice">3D盤面を読み込んでいます。</p>
      ) : null}
      {status === "failed" ? (
        <p role="status" className="game-table-3d-notice">
          3D表示を利用できないため、2D盤面で対局を続けられます。
        </p>
      ) : null}
      {selection && !interactionDisabled ? (
        <div className="game-table-3d-confirm">
          <button
            type="button"
            className="game-action-button"
            onClick={() => confirmRef.current?.()}
          >
            {tileLabel(selection.option.tile)}を
            {selection.option.action === "riichi" ? "リーチ宣言" : "打牌"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
