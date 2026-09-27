import { useState } from "react";
import { Check, Plus, Tag, Trash2, X } from "lucide-react";

export type TkoWorkLabel = { id: string; name: string; colorToken: string };

const tko_labelColors: Record<string, string> = {
  slate: "border-[#d0d5dd] bg-[#f2f4f7] text-[#475467]",
  blue: "border-[#b2ddff] bg-[#eff8ff] text-[#175cd3]",
  purple: "border-[#d9d6fe] bg-[#f4f3ff] text-[#5b51e8]",
  green: "border-[#abefc6] bg-[#ecfdf3] text-[#067647]",
  amber: "border-[#fedf89] bg-[#fffaeb] text-[#b54708]",
  red: "border-[#fecdca] bg-[#fef3f2] text-[#b42318]",
  teal: "border-[#99e2e3] bg-[#f0feff] text-[#0e9384]",
  indigo: "border-[#c7d7fe] bg-[#eef4ff] text-[#444ce7]",
  pink: "border-[#fcceee] bg-[#fdf2fa] text-[#c11574]",
  orange: "border-[#f9dbaf] bg-[#fffaeb] text-[#b93815]",
};

export function tko_labelAccent(tko_colorToken: string) {
  return tko_labelColors[tko_colorToken] ?? tko_labelColors.indigo!;
}

export function TkoLabelChip({ tko_label, tko_compact = false }: { tko_label: TkoWorkLabel; tko_compact?: boolean }) {
  return <span className={`inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${tko_labelAccent(tko_label.colorToken)}`} title={tko_label.name}>
    <Tag className="h-2.5 w-2.5 shrink-0" />{tko_compact ? tko_label.name.slice(0, 1).toUpperCase() : tko_label.name}
  </span>;
}

/** Multi-value label picker rendered inside the item inspector. */
export function TkoItemLabelsEditor({ tko_labels, tko_selectedLabelIds, tko_pending, tko_onToggle }: {
  tko_labels: TkoWorkLabel[];
  tko_selectedLabelIds: string[];
  tko_pending: boolean;
  tko_onToggle: (tko_labelId: string) => void;
}) {
  return <div className="flex flex-wrap gap-1.5">
    {tko_labels.map(tko_label => {
      const tko_selected = tko_selectedLabelIds.includes(tko_label.id);
      return <button key={tko_label.id} type="button" disabled={tko_pending} onClick={() => tko_onToggle(tko_label.id)} aria-pressed={tko_selected} className={`inline-flex h-7 items-center gap-1 rounded border px-2 text-[11px] font-semibold transition-colors disabled:cursor-wait disabled:opacity-60 ${tko_selected ? tko_labelAccent(tko_label.colorToken) : "border-[#dfe1e6] bg-white text-[#667085] hover:border-[#c7c3ff]"}`}>
        {tko_selected ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{tko_label.name}
      </button>;
    })}
    {!tko_labels.length ? <p className="text-xs text-[#98a2b3]">No labels defined for this project yet.</p> : null}
  </div>;
}

/** Project-wide label CRUD, shown in the project settings area for members who can manage labels. */
export function TkoProjectLabelsManager({ tko_labels, tko_pending, tko_onCreate, tko_onUpdate, tko_onDelete }: {
  tko_labels: TkoWorkLabel[];
  tko_pending: boolean;
  tko_onCreate: (tko_name: string, tko_colorToken: string) => void;
  tko_onUpdate: (tko_labelId: string, tko_patch: { name?: string; colorToken?: string }) => void;
  tko_onDelete: (tko_labelId: string) => void;
}) {
  const [tko_name, setTkoName] = useState("");
  const [tko_color, setTkoColor] = useState("indigo");
  const [tko_editingId, setTkoEditingId] = useState<string | null>(null);
  const [tko_editName, setTkoEditName] = useState("");
  const tko_colorChoices = ["slate", "blue", "purple", "green", "amber", "red", "teal", "indigo", "pink", "orange"];
  return <div className="space-y-3">
    <form onSubmit={tko_event => { tko_event.preventDefault(); if (!tko_name.trim()) return; tko_onCreate(tko_name.trim(), tko_color); setTkoName(""); }} className="flex flex-wrap items-center gap-2">
      <label className="min-w-40 flex-1 text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">New label
        <input value={tko_name} onChange={tko_event => setTkoName(tko_event.target.value)} placeholder="Label name" className="mt-1 block h-8 w-full border border-[#d0d5dd] px-2 text-xs font-normal normal-case tracking-normal text-[#344054] outline-none focus:border-[#0c66e4]" />
      </label>
      <label className="text-[10px] font-bold uppercase tracking-[.08em] text-[#667085]">Color
        <select value={tko_color} onChange={tko_event => setTkoColor(tko_event.target.value)} className="mt-1 block h-8 w-28 border border-[#d0d5dd] bg-white px-2 text-xs font-normal normal-case tracking-normal text-[#344054] outline-none focus:border-[#0c66e4]">
          {tko_colorChoices.map(tko_choice => <option key={tko_choice} value={tko_choice}>{tko_choice}</option>)}
        </select>
      </label>
      <button type="submit" disabled={tko_pending || !tko_name.trim()} className="mt-3 h-8 bg-[#0c66e4] px-3 text-xs font-semibold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60">Create label</button>
    </form>
    <div className="divide-y divide-[#f2f4f7] border border-[#eaecf0]">
      {tko_labels.map(tko_label => <article key={tko_label.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
        <TkoLabelChip tko_label={tko_label} />
        {tko_editingId === tko_label.id ? <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <input value={tko_editName} onChange={tko_event => setTkoEditName(tko_event.target.value)} className="h-7 min-w-0 flex-1 border border-[#d0d5dd] px-2 text-xs outline-none focus:border-[#0c66e4]" />
          <button type="button" aria-label={`Save ${tko_label.name}`} disabled={tko_pending || !tko_editName.trim()} onClick={() => { tko_onUpdate(tko_label.id, { name: tko_editName.trim() }); setTkoEditingId(null); }} className="grid h-7 w-7 place-items-center border border-[#b3d4ff] text-[#0c66e4] hover:bg-[#deebff] disabled:opacity-50"><Check className="h-3.5 w-3.5" /></button>
          <button type="button" aria-label={`Cancel editing ${tko_label.name}`} onClick={() => setTkoEditingId(null)} className="grid h-7 w-7 place-items-center border border-[#d0d5dd] text-[#667085] hover:bg-[#f1f2f4]"><X className="h-3.5 w-3.5" /></button>
        </span> : <span className="min-w-0 flex-1 truncate text-[11px] text-[#667085]">{tko_label.colorToken}</span>}
        <button type="button" disabled={tko_pending} onClick={() => { setTkoEditingId(tko_label.id); setTkoEditName(tko_label.name); }} className="h-7 border border-[#d0d5dd] px-2 text-[10px] font-semibold text-[#344054] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:opacity-50">Rename</button>
        <button type="button" aria-label={`Delete ${tko_label.name}`} disabled={tko_pending} onClick={() => tko_onDelete(tko_label.id)} className="grid h-7 w-7 place-items-center border border-[#fecdca] text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
      </article>)}
      {!tko_labels.length ? <p className="px-3 py-4 text-xs text-[#98a2b3]">No project labels yet. Create the first one above.</p> : null}
    </div>
  </div>;
}
