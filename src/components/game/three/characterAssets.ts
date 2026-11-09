import p0 from "../characters3d/textures/p0-reference.jpg";
import p1 from "../characters3d/textures/p1-reference.jpg";
import p2 from "../characters3d/textures/p2-reference.jpg";
import p3 from "../characters3d/textures/p3-reference.jpg";

/** Next gives source-derived textures content hashes, shared with the PWA. */
export const CHARACTER_TEXTURES: Readonly<Record<string, string>> =
  Object.freeze({
    "src/components/game/characters3d/textures/p0-reference.jpg": p0.src,
    "src/components/game/characters3d/textures/p1-reference.jpg": p1.src,
    "src/components/game/characters3d/textures/p2-reference.jpg": p2.src,
    "src/components/game/characters3d/textures/p3-reference.jpg": p3.src,
  });
