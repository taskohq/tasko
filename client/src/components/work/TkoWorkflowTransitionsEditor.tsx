import { ArrowRight, Shuffle } from "lucide-react";

export type TkoWorkflowTransitionRow = { fromStatusId: string | null; toStatusId: string; allowed: boolean };

/** Allowed-transitions editor per PRD 07 §6: one toggle per from→to pair of the project workflow. */
export function TkoWorkflowTransitionsEditor({ tko_statuses, tko_transitions, tko_pending, tko_onToggle }: {
  tko_statuses: Array<{ id: string; name: string }>;
  tko_transitions: TkoWorkflowTransitionRow[];
  tko_pending: boolean;
  tko_onToggle: (tko_fromStatusId: string | null, tko_toStatusId: string, tko_allowed: boolean) => void;
}) {
  const tko_statusNameById = new Map(tko_statuses.map(tko_status => [tko_status.id, tko_status.name]));
  const tko_pairs = tko_statuses.flatMap(tko_from => tko_statuses.filter(tko_to => tko_to.id !== tko_from.id).map(tko_to => ({ tko_from, tko_to })));
  if (!tko_pairs.length) return <p className="text-xs text-[#98a2b3]">Add at least two columns before tuning transitions.</p>;
  return <div className="space-y-1">
    {tko_pairs.map(({ tko_from, tko_to }) => {
      const tko_row = tko_transitions.find(tko_entry => tko_entry.fromStatusId === tko_from.id && tko_entry.toStatusId === tko_to.id);
      const tko_allowed = tko_row ? tko_row.allowed : true;
      return <div key={`${tko_from.id}->${tko_to.id}`} className="flex items-center gap-2 border border-[#eaecf0] bg-[#fcfcfd] px-2 py-1.5">
        <Shuffle className="h-3 w-3 shrink-0 text-[#98a2b3]" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#344054]">{tko_statusNameById.get(tko_from.id)} <ArrowRight className="inline h-3 w-3 text-[#98a2b3]" /> {tko_statusNameById.get(tko_to.id)}</span>
        <label className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold text-[#667085]">
          <input type="checkbox" checked={tko_allowed} disabled={tko_pending} onChange={tko_event => tko_onToggle(tko_from.id, tko_to.id, tko_event.target.checked)} className="h-3.5 w-3.5 accent-[#0c66e4] disabled:cursor-wait" />
          {tko_allowed ? "Allowed" : "Blocked"}
        </label>
      </div>;
    })}
    <p className="text-[10px] leading-4 text-[#98a2b3]">Every transition is allowed until you persist rows for this workflow. Blocked pairs reject status changes on the server.</p>
  </div>;
}
