import pino from "pino";

export const tko_logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: "tasko-platform",
  },
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "token", "secret"],
    censor: "[REDACTED]",
  },
});

export function createCorrelationId(tko_candidate?: string): string {
  return tko_candidate && tko_candidate.length <= 128 ? tko_candidate : crypto.randomUUID();
}
