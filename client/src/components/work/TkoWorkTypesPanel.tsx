import { type FormEvent, useState } from "react";
import { Shapes } from "lucide-react";

export type TkoWorkTypeRow = { id: string; name: string; category: string; icon: string };

/** Project work types admin: custom types per PRD 07 §5, in the project settings area. */
export function TkoWorkTypesPanel({ tko_workTypes, tko_pending, tko_onCreate, tko_onUpdate, tko_onSetItemType, tko_itemWorkTypeId, tko_canEdit }: {
  tko_workTypes: TkoWorkTypeRow[];
  tko_pending: boolean;
  tko_onCreate: (tko_input: { name: string; category: string }) => void;
  tko_onUpdate: (tko_workTypeId: string, tko_patch: { name?: string; icon?: string }) => void;
  tko_onSetItemType?: (tko_workTypeId: string) => void;
  tko_itemWorkTypeId?: string | null;
  tko_canEdit: boolean;
}) {
  const [tko_name, setTkoName] = useState("");
  const [tko_category, setTkoCategory] = useState("task");
  const [tko_renamingId, setTkoRenamingId] = useState<string | null>(null);
  const [tko_renameValue, setTkoRenameValue] = useState("");
  const tko_submit = (tko_event: FormEvent) => {
    tko_event.preventDefault();
    if (!tko_name.trim()) return;
    tko_onCreate({ name: tko_name.trim(), category: tko_category });
    setTkoName("");
  };
  return <div className="space-y-3">
    {tko_canEdit ? <form onSubmit={tko_submit} className="flex flex-wrap items-end gap-2">
      <label className="min-w-40 flex-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">New work type
        <input value={tko_name} onChange={tko_event => setTkoName(tko_event.target.value)} placeholder="Type name" className="mt-1 block h-8 w-full border border-[#d0d5dd] px-2 text-xs font-normal normal-case tracking-normal text-[#344054] outline-none focus:border-[#0c66e4]" />
      </label>
      <label className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">Category
        <select value={tko_category} onChange={tko_event => setTkoCategory(tko_event.target.value)} className="mt-1 block h-8 w-32 border border-[#d0d5dd] bg-white px-2 text-xs font-normal normal-case tracking-normal text-[#344054] outline-none focus:border-[#0c66e4]">
          {["epic", "story", "task", "bug", "request", "milestone"].map(tko_choice => <option key={tko_choice} value={tko_choice}>{tko_choice}</option>)}
        </select>
      </label>
      <button type="submit" disabled={tko_pending || !tko_name.trim()} className="h-8 bg-[#0c66e4] px-3 text-xs font-semibold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60">Create type</button>
    </form> : null}
    <div className="divide-y divide-[#f2f4f7] border border-[#eaecf0]">
      {tko_workTypes.map(tko_type => <article key={tko_type.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#344054]"><Shapes className="h-3.5 w-3.5 text-[#5b51e8]" />{tko_type.name}</span>
        <span className="border border-[#e4e7ec] bg-[#f9fafb] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#667085]">{tko_type.category}</span>
        {tko_renamingId === tko_type.id ? <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input value={tko_renameValue} onChange={tko_event => setTkoRenameValue(tko_event.target.value)} className="h-7 min-w-0 flex-1 border border-[#d0d5dd] px-2 text-xs outline-none focus:border-[#0c66e4]" />
          <button type="button" disabled={tko_pending || !tko_renameValue.trim()} onClick={() => { tko_onUpdate(tko_type.id, { name: tko_renameValue.trim() }); setTkoRenamingId(null); }} className="h-7 border border-[#b3d4ff] px-2 text-[10px] font-semibold text-[#0c66e4] hover:bg-[#deebff] disabled:opacity-50">Save</button>
        </span> : null}
        <span className="ml-auto flex items-center gap-1.5">
          {tko_canEdit && tko_renamingId !== tko_type.id ? <button type="button" disabled={tko_pending} onClick={() => { setTkoRenamingId(tko_type.id); setTkoRenameValue(tko_type.name); }} className="h-7 border border-[#d0d5dd] px-2 text-[10px] font-semibold text-[#344054] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-50">Rename</button> : null}
          {tko_onSetItemType ? <button type="button" disabled={tko_pending || tko_itemWorkTypeId === tko_type.id} onClick={() => tko_onSetItemType(tko_type.id)} className={`h-7 border px-2 text-[10px] font-semibold disabled:opacity-50 ${tko_itemWorkTypeId === tko_type.id ? "border-[#abefc6] bg-[#ecfdf3] text-[#067647]" : "border-[#d0d5dd] text-[#344054] hover:border-[#0c66e4] hover:text-[#0c66e4]"}`}>{tko_itemWorkTypeId === tko_type.id ? "Current" : "Set on item"}</button> : null}
        </span>
      </article>)}
      {!tko_workTypes.length ? <p className="px-3 py-4 text-xs text-[#98a2b3]">No work types found.</p> : null}
    </div>
  </div>;
}
