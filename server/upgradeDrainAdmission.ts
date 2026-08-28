import type { DrainPhase } from "./drainController";

export type UpgradeReservation<TRejection> =
  | { readonly ok: false; readonly rejection: TRejection }
  | { readonly ok: true; readonly phase: DrainPhase };

export type UpgradeDrainAdmission<TRejection> =
  | { readonly outcome: "maintenance" }
  | { readonly outcome: "rejected"; readonly rejection: TRejection }
  | { readonly outcome: "proceed" };

function terminal(phase: DrainPhase): boolean {
  return phase === "drained" || phase === "terminating";
}

/**
 * Linearizes drain admission around the fallible upgrade reservation. A clock
 * boundary may seal the controller during `reserve`; that exact reservation
 * is synchronously rolled back before the caller emits HTTP 503.
 */
export function admitUpgradeDuringDrain<TRejection>(options: {
  readonly observePhase: () => DrainPhase;
  readonly reserve: () => UpgradeReservation<TRejection>;
  readonly rollback: () => void;
}): UpgradeDrainAdmission<TRejection> {
  if (terminal(options.observePhase())) return { outcome: "maintenance" };
  const reservation = options.reserve();
  if (!reservation.ok) {
    return { outcome: "rejected", rejection: reservation.rejection };
  }
  if (terminal(reservation.phase)) {
    options.rollback();
    return { outcome: "maintenance" };
  }
  return { outcome: "proceed" };
}
