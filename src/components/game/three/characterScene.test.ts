import { describe, expect, it } from "vitest";
import { createDisplayEnvelope } from "@/domain/display/displaySnapshot";
import { createGame } from "@/domain/game/engine";
import { selectView } from "@/domain/game/gameView";
import { createCharacterController } from "../characters3d/controller";
import {
  CHARACTER_METRES_TO_SCENE,
  characterPlacement,
  projectCharacterSurfaces,
} from "./characterScene";
import { camera, localPoint, project, transform } from "./math";

describe("live character geometry boundary", () => {
  it("keeps four actor identities and material bindings through all observer positions", () => {
    const state = createGame({ seed: 1 });
    const controller = createCharacterController();
    for (const [index, playerId] of (
      ["p0", "p1", "p2", "p3"] as const
    ).entries()) {
      const frame = createDisplayEnvelope(
        {
          playerId,
          isHost: playerId === "p0",
          phase: state.phase,
          pending: state.pending,
          view: selectView(state, playerId),
          displaySource: {
            kind: "local",
            sessionId: "actor-boundary",
            generation: 1,
            revision: index,
          },
        },
        "restore",
      );
      if (!frame) throw new Error("Local display frame missing");
      controller.publish(frame, [], frame.roundKey, index);
      const actors = controller.sample(index, true);
      expect(actors.filter((actor) => actor.kind === "bench")).toHaveLength(1);
      expect(
        actors.find((actor) => actor.playerId === playerId)?.position,
      ).toBe("self");
      const surfaces = projectCharacterSurfaces(actors);
      expect(surfaces.length).toBeGreaterThan(4);
      expect(surfaces.length).toBeLessThanOrEqual(64);
      expect(new Set(surfaces.map((surface) => surface.id)).size).toBe(
        surfaces.length,
      );
      for (const actor of actors) {
        expect(actor.model.id).toBe(actor.playerId);
        const own = surfaces.filter((surface) =>
          surface.id.startsWith(`${actor.playerId}/`),
        );
        expect(own.length).toBeGreaterThan(0);
        for (const surface of own) {
          expect(surface.position).toBe(actor.position);
          expect(surface.vertices.length).toBeGreaterThan(0);
          expect(surface.vertices.length % 24).toBe(0);
          expect(surface.vertices.every(Number.isFinite)).toBe(true);
          expect(actor.model.materials).toContain(surface.material);
        }
      }
      for (const aspect of [1280 / 810, 393 / 810, 320 / 760]) {
        const view = camera(aspect, true);
        for (const surface of surfaces) {
          const placement = characterPlacement(surface.position);
          const scale = CHARACTER_METRES_TO_SCENE;
          const model = transform(
            placement.center,
            [0, placement.yaw, 0],
            [scale, scale, scale],
          );
          for (
            let offset = 0;
            offset < surface.vertices.length;
            offset += 8 * 37
          ) {
            const point = localPoint(model, [
              surface.vertices[offset],
              surface.vertices[offset + 1],
              surface.vertices[offset + 2],
            ]);
            expect(project(view, point, aspect * 1000, 1000).visible).toBe(
              true,
            );
          }
        }
      }
    }
    controller.dispose();
    expect(controller.sample(5)).toEqual([]);
  });
});
