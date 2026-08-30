/**
 * Backward-compatible UI import for the neutral game persistence module.
 * Runtime and journal logic lives in `src/domain/game` so the online server can
 * reuse it without depending on the presentation tree.
 */
export * from "@/domain/game/gamePersistence";
