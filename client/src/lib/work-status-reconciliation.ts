export type TkoWorkflowStatusPresentation = {
  id: string;
  name: string;
};

/**
 * Resolves presentation from the workflow-status identity, not its coarse
 * category. Board placement and all other Work views must use this same ID.
 */
export function tko_displayWorkflowStatus(
  tko_statusId: string | undefined,
  tko_statuses: readonly TkoWorkflowStatusPresentation[],
  tko_fallback: string,
): string {
  return tko_statuses.find(tko_status => tko_status.id === tko_statusId)?.name ?? tko_fallback;
}
