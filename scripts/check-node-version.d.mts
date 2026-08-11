export function requiredNodeRange(): string;
export function nodeVersionError(
  version: string,
  range?: string,
): string | null;
export function checkNodeVersion(version?: string): void;
