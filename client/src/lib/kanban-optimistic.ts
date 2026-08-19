export type TkoOptimisticEntity = { id: string };

export function tko_addOptimistic<T extends TkoOptimisticEntity>(tko_items: T[], tko_item: T): T[] {
  return [...tko_items, tko_item];
}

export function tko_removeOptimistic<T extends TkoOptimisticEntity>(tko_items: T[], tko_optimisticId: string): T[] {
  return tko_items.filter(tko_item => tko_item.id !== tko_optimisticId);
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
