import type { CharacterPlayerId } from "@/domain/game/characters";
import type { V3 } from "./types";

export interface ModelProfile {
  readonly height: number;
  readonly shoulders: number;
  readonly waist: number;
  readonly belly: number;
  readonly depth: number;
  readonly headWidth: number;
  readonly jawWidth: number;
  readonly headDepth: number;
  readonly headLength: number;
  readonly hairStyle: "swept" | "wave" | "crop" | "fringe";
  readonly hairColor: V3;
  readonly skinColor: V3;
  readonly shoe: "boot" | "trainer" | "cargo-shoe" | "high-top";
  readonly accent: V3;
  /** pixels in the untouched 1536x1024 sheet, from top of hair to sole. */
  readonly photo: {
    top: number;
    floor: number;
    front: number;
    right: number;
    back: number;
    left: number;
  };
  readonly source: string;
  readonly sha256: string;
  /** Per-view head registration in source pixels. The p2 profiles have a
   * different jaw/hair height from its expressive front drawing. */
  readonly headViews?: Readonly<
    Record<
      "front" | "right" | "back" | "left",
      {
        readonly center: number;
        readonly halfWidth: number;
        readonly top: number;
        readonly bottom: number;
        readonly mirror?: boolean;
      }
    >
  >;
}

/** Individual silhouette measurements, not one mesh with four color uniforms. */
export const MODEL_PROFILES: Readonly<Record<CharacterPlayerId, ModelProfile>> =
  {
    p0: {
      height: 1.8,
      shoulders: 0.219,
      waist: 0.153,
      belly: 0.166,
      depth: 0.105,
      headWidth: 0.087,
      jawWidth: 0.064,
      headDepth: 0.091,
      headLength: 0.239,
      hairStyle: "swept",
      hairColor: [0.026, 0.025, 0.024],
      skinColor: [0.637, 0.454, 0.367],
      shoe: "boot",
      accent: [0.66, 0.055, 0.036],
      photo: {
        top: 126,
        floor: 872,
        front: 105,
        right: 501,
        back: 869,
        left: 1240,
      },
      source: "p0-soakuhin-character-sheet.png",
      sha256:
        "ef6c81eb0ce02dbc5227d3320f61c760527214eea1ecd8e7e42cd88dbb4aebbf",
    },
    p1: {
      height: 1.75,
      shoulders: 0.204,
      waist: 0.145,
      belly: 0.156,
      depth: 0.099,
      headWidth: 0.085,
      jawWidth: 0.068,
      headDepth: 0.088,
      headLength: 0.225,
      hairStyle: "wave",
      hairColor: [0.16, 0.087, 0.037],
      skinColor: [0.552, 0.409, 0.319],
      shoe: "trainer",
      accent: [0.055, 0.22, 0.53],
      photo: {
        top: 126,
        floor: 872,
        front: 106,
        right: 501,
        back: 863,
        left: 1240,
      },
      source: "p1-ryuji-character-sheet.png",
      sha256:
        "5a02f954603f5b211fd8f670e2f8e503bccc3a8d7a926be58ed46015514101bf",
    },
    p2: {
      height: 1.75,
      shoulders: 0.246,
      waist: 0.184,
      belly: 0.209,
      depth: 0.137,
      headWidth: 0.105,
      jawWidth: 0.087,
      headDepth: 0.101,
      headLength: 0.238,
      hairStyle: "crop",
      hairColor: [0.019, 0.021, 0.021],
      skinColor: [0.484, 0.306, 0.232],
      shoe: "cargo-shoe",
      accent: [0.82, 0.57, 0.08],
      photo: {
        top: 130,
        floor: 759,
        front: 107,
        right: 507,
        back: 863,
        left: 1243,
      },
      source: "p2-masaki-character-sheet.png",
      headViews: {
        front: { center: 107, halfWidth: 35, top: 130, bottom: 225 },
        right: { center: 501, halfWidth: 41, top: 131, bottom: 216 },
        back: { center: 878, halfWidth: 37, top: 130, bottom: 200 },
        // The supplied left profile faces image-left too; preserve this fact
        // with an explicit registration, rather than mirroring the wrong UV.
        left: {
          center: 1256,
          halfWidth: 41,
          top: 131,
          bottom: 216,
          mirror: true,
        },
      },
      sha256:
        "ce218809a3ec175d875228e807332a2190d82f3b76cf81e744a2073759b05b0c",
    },
    p3: {
      height: 1.75,
      shoulders: 0.243,
      waist: 0.213,
      belly: 0.238,
      depth: 0.156,
      headWidth: 0.111,
      jawWidth: 0.098,
      headDepth: 0.108,
      headLength: 0.238,
      hairStyle: "fringe",
      hairColor: [0.023, 0.027, 0.022],
      skinColor: [0.582, 0.415, 0.296],
      shoe: "high-top",
      accent: [0.23, 0.4, 0.1],
      photo: {
        top: 130,
        floor: 852,
        front: 107,
        right: 510,
        back: 862,
        left: 1242,
      },
      source: "p3-hechima-character-sheet.png",
      sha256:
        "bcdad1e1faf55e6aab426d7b372e947d13d45c30de887f6d7956eaa6dd78aca5",
    },
  };
/** Only p2 needs new registrations; other three atlases remain byte-identical. */
export function headTextureRegions(p: ModelProfile) {
  if (!p.headViews) return [];
  return (["right", "back", "left"] as const).map((view, i) => {
    const q = p.headViews![view];
    return {
      view,
      source: {
        left: q.center - q.halfWidth - 8,
        top: q.top - 5,
        width: q.halfWidth * 2 + 16,
        height: q.bottom - q.top + 10,
      },
      atlas: { left: 512 + i * 256, top: 1024, width: 256, height: 256 },
    };
  });
}
