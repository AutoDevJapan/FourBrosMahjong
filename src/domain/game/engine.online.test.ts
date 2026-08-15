import { describe, expect, it } from "vitest";
import {
  createGame,
  discard,
  type EngineState,
  setHumanPlayerIds,
} from "./engine";

function drawnTile(state: EngineState) {
  const tile = state.hand?.drawn?.tile;
  if (tile === undefined) throw new Error("expected a drawn tile");
  return tile;
}

describe("engine: multiple human players", () => {
  it("assigns the next input to the correct online player and rejects another player's action", () => {
    let state = createGame({ seed: 20260815, humanPlayerIds: ["p0", "p1"] });

    expect(state.pending?.playerId).toBe("p0");
    state = discard(state, drawnTile(state), "p0");

    expect(state.pending?.playerId).toBe("p1");
    const rejected = discard(state, drawnTile(state), "p0");
    expect(rejected).toBe(state);

    const progressed = discard(state, drawnTile(state), "p1");
    expect(progressed).not.toBe(state);
  });

  it("can add a human seat without changing the current hand or seed progression", () => {
    const initial = createGame({ seed: 17 });
    const state = setHumanPlayerIds(initial, ["p0", "p1"]);

    expect(state.hand).toBe(initial.hand);
    expect(state.pending?.playerId).toBe("p0");

    const afterP0 = discard(state, drawnTile(state), "p0");
    expect(afterP0.pending?.playerId).toBe("p1");
  });
});
