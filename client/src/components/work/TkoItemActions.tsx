import { useState } from "react";
import { Copy, FolderInput } from "lucide-react";

/** Item actions per PRD 07 §4: duplicate and move-to-project. */
export function TkoItemActions({ tko_projects, tko_currentProjectId, tko_pending, tko_onDuplicate, tko_onMove }: {
  tko_projects: Array<{ id: string; name: string; key: string }>;
  tko_currentProjectId: string | undefined;
  tko_pending: boolean;
  tko_onDuplicate: () => void;
  tko_onMove: (tko_targetProjectId: string) => void;
}) {
  const [tko_targetProjectId, setTkoTargetProjectId] = useState("");
  const tko_moveTargets = tko_projects.filter(tko_project => tko_project.id !== tko_currentProjectId);
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" disabled={tko_pending} onClick={tko_onDuplicate} className="inline-flex h-8 items-center gap-1.5 border border-[#d0d5dd] bg-white px-2.5 text-xs font-semibold text-[#344054] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-wait disabled:opacity-60">
      <Copy className="h-3.5 w-3.5" />Duplicate
    </button>
    {tko_moveTargets.length ? <span className="inline-flex items-center gap-1.5">
      <label className="sr-only" htmlFor="move-project-target">Move to project</label>
      <select id="move-project-target" value={tko_targetProjectId} disabled={tko_pending} onChange={tko_event => setTkoTargetProjectId(tko_event.target.value)} className="h-8 max-w-44 border border-[#d0d5dd] bg-white px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4] disabled:opacity-60">
        <option value="">Move to project…</option>
        {tko_moveTargets.map(tko_project => <option key={tko_project.id} value={tko_project.id}>{tko_project.key} · {tko_project.name}</option>)}
      </select>
      <button type="button" disabled={tko_pending || !tko_targetProjectId} onClick={() => { if (tko_targetProjectId) tko_onMove(tko_targetProjectId); setTkoTargetProjectId(""); }} aria-label="Move work item to selected project" className="inline-flex h-8 items-center gap-1.5 border border-[#d0d5dd] px-2 text-xs font-semibold text-[#344054] hover:border-[#0c66e4] hover:text-[#0c66e4] disabled:cursor-not-allowed disabled:opacity-60">
        <FolderInput className="h-3.5 w-3.5" />Move
      </button>
    </span> : null}
  </div>;
}
