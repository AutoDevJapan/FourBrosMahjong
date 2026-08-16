export type E2eServerMode = "development" | "production";

/** The mode used by Playwright's webServer and by mode-sensitive assertions. */
export function e2eServerMode(): E2eServerMode {
  const flag = process.env.E2E_PROD;
  if (flag !== undefined && flag !== "0" && flag !== "1") {
    throw new Error(`E2E_PROD must be 0 or 1: ${flag}`);
  }
  return flag === "1" ? "production" : "development";
}
