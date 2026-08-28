export interface SupersedableConnection {
  superseded: boolean;
}

export function isAuthoritativeConnection(
  connection: SupersedableConnection,
): boolean {
  return !connection.superseded;
}

/** Authority is revoked synchronously before initiating transport close. */
export function supersedeConnection(
  connection: SupersedableConnection,
  close: () => void,
): void {
  connection.superseded = true;
  close();
}
