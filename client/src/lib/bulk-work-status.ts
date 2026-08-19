export type TkoBulkMoveItem = {
  id: string;
  statusId?: string;
  version?: number;
};

export type TkoBulkMoveResult = {
  succeededIds: string[];
  failedIds: string[];
  skippedIds: string[];
};

export async function tko_runBulkStatusMove({
  items,
  targetStatusId,
  move,
}: {
  items: TkoBulkMoveItem[];
  targetStatusId: string;
  move: (input: { workItemId: string; targetStatusId: string; expectedVersion: number }) => Promise<unknown>;
}): Promise<TkoBulkMoveResult> {
  const tko_result: TkoBulkMoveResult = { succeededIds: [], failedIds: [], skippedIds: [] };

  for (const tko_item of items) {
    if (!tko_item.version || tko_item.statusId === targetStatusId) {
      tko_result.skippedIds.push(tko_item.id);
      continue;
    }

    try {
      await move({ workItemId: tko_item.id, targetStatusId, expectedVersion: tko_item.version });
      tko_result.succeededIds.push(tko_item.id);
    } catch {
      tko_result.failedIds.push(tko_item.id);
    }
  }

  return tko_result;
}
