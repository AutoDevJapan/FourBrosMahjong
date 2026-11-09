import type { CharacterPlayerId } from "@/domain/game/characters";
import type { V3 } from "./types";

export interface ModelProfile {
  readonly seamColors?: readonly {
    readonly xyz: V3;
    readonly front: V3;
    readonly side: V3;
  }[];
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
      seamColors: [
        {
          xyz: [0.0418926, 1.5853636, 0.0574063],
          front: [1, 1, 1],
          side: [0.919022, 0.809936, 0.740011],
        },
        {
          xyz: [-0.0418926, 1.5853636, 0.0574063],
          front: [1, 1, 1],
          side: [0.342455, 0.259091, 0.187685],
        },
        {
          xyz: [0.0471271, 1.6005, 0.0593478],
          front: [1, 1, 1],
          side: [0.972478, 0.944174, 0.948667],
        },
        {
          xyz: [-0.0471271, 1.6005, 0.0593478],
          front: [1, 1, 1],
          side: [0.667041, 0.612066, 0.514668],
        },
        {
          xyz: [0.0523648, 1.6156363, 0.0611214],
          front: [1, 1, 1],
          side: [0.883756, 0.782942, 0.678431],
        },
        {
          xyz: [-0.0523648, 1.6156363, 0.0611214],
          front: [1, 1, 1],
          side: [0.64375, 0.599922, 0.578517],
        },
        {
          xyz: [0.0560797, 1.6310909, 0.0625879],
          front: [1, 1, 1],
          side: [1, 0.93184, 0.896426],
        },
        {
          xyz: [-0.0560797, 1.6310909, 0.0625879],
          front: [1, 1, 1],
          side: [0.532751, 0.323764, 0.235766],
        },
        {
          xyz: [0.0593547, 1.6466364, 0.0638775],
          front: [0.963997, 1, 1],
          side: [1, 0.966635, 0.899956],
        },
        {
          xyz: [-0.0593547, 1.6466364, 0.0638775],
          front: [1, 1, 1],
          side: [0.817546, 0.639883, 0.510768],
        },
        {
          xyz: [0.0611953, 1.6623182, 0.0644698],
          front: [0.930403, 0.92498, 0.882467],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0611953, 1.6623182, 0.0644698],
          front: [1, 1, 1],
          side: [0.65325, 0.426354, 0.323611],
        },
        {
          xyz: [0.0601812, 1.6782727, 0.0637598],
          front: [1, 1, 1],
          side: [0.860841, 0.575284, 0.429573],
        },
        {
          xyz: [-0.0601812, 1.6782727, 0.0637598],
          front: [1, 1, 1],
          side: [0.407942, 0.22985, 0.191065],
        },
        {
          xyz: [0.0591706, 1.6942272, 0.0631519],
          front: [1, 1, 1],
          side: [0.297814, 0.245664, 0.212629],
        },
        {
          xyz: [0.0545836, 1.7145455, 0.0595547],
          front: [0.832737, 0.817292, 0.826759],
          side: [1, 1, 1],
        },
      ],
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
      // Registered against the existing source image; no new texture pixels.
      headViews: {
        front: { center: 105, halfWidth: 36, top: 126, bottom: 225 },
        right: {
          center: 496,
          halfWidth: 38,
          top: 126,
          bottom: 218,
        },
        back: {
          center: 872,
          halfWidth: 36,
          top: 126,
          bottom: 212,
        },
        left: {
          center: 1253,
          halfWidth: 39,
          top: 130,
          bottom: 218,
          mirror: true,
        },
      },
      sha256:
        "ef6c81eb0ce02dbc5227d3320f61c760527214eea1ecd8e7e42cd88dbb4aebbf",
    },
    p1: {
      seamColors: [
        {
          xyz: [0.0423571, 1.5409091, 0.0541153],
          front: [0.456992, 0.366924, 0.319389],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0423571, 1.5409091, 0.0541153],
          front: [1, 1, 1],
          side: [0.416202, 0.380545, 0.261457],
        },
        {
          xyz: [0.0440949, 1.5493636, 0.0556222],
          front: [1, 1, 1],
          side: [0.930403, 0.90108, 0.853558],
        },
        {
          xyz: [-0.0440949, 1.5493636, 0.0556222],
          front: [1, 1, 1],
          side: [0.669578, 0.64184, 0.550519],
        },
        {
          xyz: [0.0477847, 1.5645, 0.0574692],
          front: [1, 1, 1],
          side: [0.952181, 0.8867, 0.866834],
        },
        {
          xyz: [0.0514777, 1.5796363, 0.0591503],
          front: [1, 1, 1],
          side: [0.980719, 0.824044, 0.762699],
        },
        {
          xyz: [-0.0514777, 1.5796363, 0.0591503],
          front: [1, 1, 1],
          side: [0.757835, 0.610238, 0.435777],
        },
        {
          xyz: [0.0547908, 1.5950909, 0.0605551],
          front: [0.89242, 0.794075, 0.742758],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0547908, 1.5950909, 0.0605551],
          front: [1, 1, 1],
          side: [0.763926, 0.557358, 0.409826],
        },
        {
          xyz: [0.0579906, 1.6106364, 0.0617918],
          front: [1, 1, 1],
          side: [0.773528, 0.597094, 0.494765],
        },
        {
          xyz: [-0.0579906, 1.6106364, 0.0617918],
          front: [1, 1, 1],
          side: [0.766154, 0.587662, 0.572002],
        },
        {
          xyz: [0.0597888, 1.6263182, 0.0623546],
          front: [1, 1, 1],
          side: [0.878836, 0.724755, 0.612066],
        },
        {
          xyz: [-0.0597888, 1.6263182, 0.0623546],
          front: [0.638957, 0.851252, 1],
          side: [1, 1, 0.908132],
        },
        {
          xyz: [0.0587979, 1.6422727, 0.0616618],
          front: [1, 1, 1],
          side: [0.774524, 0.686663, 0.694986],
        },
      ],
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
      // Registered against the existing source image; no new texture pixels.
      headViews: {
        front: { center: 106, halfWidth: 35, top: 126, bottom: 225 },
        right: {
          center: 494,
          halfWidth: 38,
          top: 125,
          bottom: 225,
        },
        back: {
          center: 872,
          halfWidth: 36,
          top: 126,
          bottom: 212,
        },
        left: {
          center: 1254,
          halfWidth: 40,
          top: 129,
          bottom: 225,
          mirror: true,
        },
      },
      sha256:
        "5a02f954603f5b211fd8f670e2f8e503bccc3a8d7a926be58ed46015514101bf",
    },
    p2: {
      seamColors: [
        {
          xyz: [0.0541921, 1.527909, 0.0627376],
          front: [1, 1, 1],
          side: [0.988978, 0.88023, 0.868761],
        },
        {
          xyz: [-0.0541921, 1.527909, 0.0627376],
          front: [1, 1, 1],
          side: [0.431989, 0.259301, 0.227013],
        },
        {
          xyz: [0.0562057, 1.5363636, 0.0648949],
          front: [1, 1, 1],
          side: [0.78115, 0.648368, 0.587488],
        },
        {
          xyz: [0.0599823, 1.5515, 0.0678288],
          front: [1, 1, 1],
          side: [0.943018, 0.815778, 0.794395],
        },
        {
          xyz: [-0.0599823, 1.5515, 0.0678288],
          front: [1, 1, 1],
          side: [0.60918, 0.381303, 0.349665],
        },
        {
          xyz: [0.0637621, 1.5666363, 0.0701907],
          front: [0.943985, 0.930034, 0.944804],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0637621, 1.5666363, 0.0701907],
          front: [1, 1, 1],
          side: [0.933698, 0.83769, 0.734772],
        },
        {
          xyz: [0.0676795, 1.5820909, 0.0715389],
          front: [1, 1, 1],
          side: [0.952593, 0.975029, 0.955651],
        },
        {
          xyz: [-0.0676795, 1.5820909, 0.0715389],
          front: [1, 1, 1],
          side: [0.498055, 0.27832, 0.242298],
        },
        {
          xyz: [0.0716314, 1.5976363, 0.0722861],
          front: [1, 1, 1],
          side: [0.867634, 0.818618, 0.764986],
        },
        {
          xyz: [-0.0716314, 1.5976363, 0.0722861],
          front: [1, 1, 1],
          side: [0.407918, 0.193477, 0.125439],
        },
        {
          xyz: [0.0738538, 1.6133182, 0.0722657],
          front: [1, 1, 1],
          side: [0.798615, 0.544055, 0.44182],
        },
        {
          xyz: [-0.0738538, 1.6133182, 0.0722657],
          front: [1, 1, 1],
          side: [0.52039, 0.303761, 0.239654],
        },
        {
          xyz: [0.0726314, 1.6292727, 0.0710402],
          front: [0.955651, 0.988978, 0.97517],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0726314, 1.6292727, 0.0710402],
          front: [1, 1, 1],
          side: [0.567714, 0.386593, 0.326501],
        },
        {
          xyz: [0.0714125, 1.6452273, 0.0701718],
          front: [0.643087, 0.748208, 0.824627],
          side: [1, 1, 1],
        },
        {
          xyz: [-0.0714125, 1.6452273, 0.0701718],
          front: [1, 1, 1],
          side: [0.566783, 0.385062, 0.304869],
        },
      ],
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
      seamColors: [
        {
          xyz: [-0.061044, 1.527909, 0.0679077],
          front: [1, 1, 1],
          side: [0.346908, 0.217638, 0.136722],
        },
        {
          xyz: [0.0629052, 1.5363636, 0.0706073],
          front: [1, 1, 1],
          side: [0.45932, 0.351699, 0.292884],
        },
        {
          xyz: [-0.0629052, 1.5363636, 0.0706073],
          front: [1, 1, 1],
          side: [0.465467, 0.304073, 0.206782],
        },
        {
          xyz: [0.065328, 1.5515, 0.0744404],
          front: [1, 1, 1],
          side: [0.668346, 0.484267, 0.323692],
        },
        {
          xyz: [-0.065328, 1.5515, 0.0744404],
          front: [1, 1, 1],
          side: [0.909516, 0.732935, 0.557358],
        },
        {
          xyz: [0.067754, 1.5666363, 0.0772933],
          front: [1, 1, 1],
          side: [0.830022, 0.716333, 0.604219],
        },
        {
          xyz: [-0.067754, 1.5666363, 0.0772933],
          front: [1, 1, 1],
          side: [0.945824, 0.772749, 0.664758],
        },
        {
          xyz: [0.0715461, 1.5820909, 0.0784594],
          front: [1, 1, 1],
          side: [0.788991, 0.579906, 0.451929],
        },
        {
          xyz: [-0.0715461, 1.5820909, 0.0784594],
          front: [1, 1, 1],
          side: [0.7593, 0.608754, 0.480647],
        },
        {
          xyz: [0.0757236, 1.5976363, 0.0786098],
          front: [1, 1, 1],
          side: [0.511772, 0.430283, 0.391492],
        },
        {
          xyz: [-0.0757236, 1.5976363, 0.0786098],
          front: [1, 1, 1],
          side: [0.810102, 0.640053, 0.522434],
        },
        {
          xyz: [-0.0780733, 1.6133182, 0.0779468],
          front: [1, 1, 1],
          side: [0.753551, 0.487504, 0.306059],
        },
        {
          xyz: [-0.0767815, 1.6292727, 0.0762228],
          front: [1, 1, 1],
          side: [0.870415, 0.813834, 0.719665],
        },
      ],
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
      // Registered against the existing source image; no new texture pixels.
      headViews: {
        front: { center: 114, halfWidth: 46, top: 130, bottom: 250 },
        right: {
          center: 498,
          halfWidth: 44,
          top: 135,
          bottom: 238,
        },
        back: {
          center: 868,
          halfWidth: 40,
          top: 130,
          bottom: 218,
        },
        left: {
          center: 1253,
          halfWidth: 44,
          top: 134,
          bottom: 238,
          mirror: true,
        },
      },
      sha256:
        "bcdad1e1faf55e6aab426d7b372e947d13d45c30de887f6d7956eaa6dd78aca5",
    },
  };
/** Keep the existing p2-only padded atlas; registration does not rebake textures. */
export function headTextureRegions(p: ModelProfile) {
  // Only crop-style p2 has the padded head atlas in the existing texture.
  if (!p.headViews || p.hairStyle !== "crop") return [];
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
