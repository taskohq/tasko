export type TkoOptimisticEntity = { id: string };

export function tko_addOptimistic<T extends TkoOptimisticEntity>(tko_items: T[], tko_item: T): T[] {
  return [...tko_items, tko_item];
}

export function tko_removeOptimistic<T extends TkoOptimisticEntity>(tko_items: T[], tko_optimisticId: string): T[] {
  return tko_items.filter(tko_item => tko_item.id !== tko_optimisticId);
}

export type TkoOptimisticMoveEntity = {
  id: string;
  statusId: string;
  rank?: string;
  tkoOptimisticOrder?: number;
};

export function tko_applyOptimisticMove<T extends TkoOptimisticMoveEntity>(tko_items: T[], tko_workItemId: string, tko_targetStatusId: string, tko_beforeWorkItemId: string | null = null): T[] {
  const tko_moving = tko_items.find(tko_item => tko_item.id === tko_workItemId);
  if (!tko_moving) return tko_items;

  const tko_targetItems = tko_items
    .filter(tko_item => tko_item.statusId === tko_targetStatusId && tko_item.id !== tko_workItemId)
    .sort((tko_left, tko_right) => (tko_left.tkoOptimisticOrder ?? Number.MAX_SAFE_INTEGER) - (tko_right.tkoOptimisticOrder ?? Number.MAX_SAFE_INTEGER) || (tko_left.rank ?? "").localeCompare(tko_right.rank ?? ""));
  const tko_beforeIndex = tko_beforeWorkItemId ? tko_targetItems.findIndex(tko_item => tko_item.id === tko_beforeWorkItemId) : -1;
  tko_targetItems.splice(tko_beforeIndex < 0 ? tko_targetItems.length : tko_beforeIndex, 0, { ...tko_moving, statusId: tko_targetStatusId });
  const tko_orderById = new Map(tko_targetItems.map((tko_item, tko_index) => [tko_item.id, tko_index]));

  return tko_items.map(tko_item => {
    const tko_next = tko_item.id === tko_workItemId ? { ...tko_item, statusId: tko_targetStatusId } : tko_item;
    const tko_order = tko_orderById.get(tko_next.id);
    return tko_order === undefined ? tko_next : { ...tko_next, tkoOptimisticOrder: tko_order };
  });
}

export type TkoOptimisticCreateResult<TCreated, TFinal> =
  | { outcome: "create-failed" }
  | { outcome: "move-failed"; created: TCreated }
  | { outcome: "success"; item: TFinal };

export async function tko_runOptimisticCreate<TCreated, TFinal = TCreated>(tko_options: {
  onOptimistic: () => void;
  onRollback: () => void;
  onReconciled: () => void;
  create: () => Promise<TCreated>;
  shouldMove: (tko_created: TCreated) => boolean;
  move: (tko_created: TCreated) => Promise<TFinal>;
}): Promise<TkoOptimisticCreateResult<TCreated, TFinal>> {
  tko_options.onOptimistic();
  let tko_created: TCreated;
  try {
    tko_created = await tko_options.create();
  } catch {
    tko_options.onRollback();
    return { outcome: "create-failed" };
  }

  let tko_final = tko_created as unknown as TFinal;
  try {
    if (tko_options.shouldMove(tko_created)) tko_final = await tko_options.move(tko_created);
  } catch {
    tko_options.onRollback();
    return { outcome: "move-failed", created: tko_created };
  }

  tko_options.onReconciled();
  return { outcome: "success", item: tko_final };
}
