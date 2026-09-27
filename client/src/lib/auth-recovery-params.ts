/**
 * Parses account-recovery token parameters from the Login page URL.
 *
 * Password-reset emails land on `${appOrigin}/login?resetToken=...` and email
 * verification links on `${appOrigin}/login?verifyToken=...`. The bare
 * `?token=` form (the spec's `/reset-password?token=...` shape) is accepted
 * for compatibility.
 */
export type TkoAuthRecoveryParams = {
  resetToken: string | null;
  verifyToken: string | null;
};

export function tko_parseAuthRecoveryParams(tko_search: string): TkoAuthRecoveryParams {
  const tko_params = new URLSearchParams(tko_search);
  const tko_reset = (tko_params.get("resetToken") ?? tko_params.get("token") ?? "").trim();
  const tko_verify = (tko_params.get("verifyToken") ?? "").trim();
  return {
    resetToken: tko_reset.length > 0 ? tko_reset : null,
    verifyToken: tko_verify.length > 0 ? tko_verify : null,
  };
}
