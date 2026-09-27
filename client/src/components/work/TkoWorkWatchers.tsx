import { Eye, EyeOff, UserPlus } from "lucide-react";

export type TkoWatcherRow = { memberId: string; displayName: string };

/** Watchers panel for the item inspector: self-watch plus manage-gated add/remove of others. */
export function TkoWatchersPanel({ tko_watchers, tko_currentMemberId, tko_members, tko_pending, tko_onWatchSelf, tko_onAddMember, tko_onRemove }: {
  tko_watchers: TkoWatcherRow[];
  tko_currentMemberId: string | undefined;
  tko_members: Array<{ id: string; displayName: string }>;
  tko_pending: boolean;
  tko_onWatchSelf: () => void;
  tko_onAddMember: (tko_memberId: string) => void;
  tko_onRemove: (tko_memberId: string) => void;
}) {
  const tko_isWatching = !!tko_currentMemberId && tko_watchers.some(tko_watcher => tko_watcher.memberId === tko_currentMemberId);
  const tko_nonWatcherMembers = tko_members.filter(tko_member => !tko_watchers.some(tko_watcher => tko_watcher.memberId === tko_member.id));
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-1.5">
      {tko_watchers.map(tko_watcher => <span key={tko_watcher.memberId} className="inline-flex h-7 items-center gap-1 rounded-full border border-[#d0d5dd] bg-[#f9fafb] pl-1 pr-2 text-[11px] font-medium text-[#344054]">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-[#deebff] text-[9px] font-bold text-[#0c66e4]">{tko_watcher.displayName.slice(0, 1).toUpperCase()}</span>
        <span className="max-w-32 truncate">{tko_watcher.displayName}{tko_watcher.memberId === tko_currentMemberId ? " (you)" : ""}</span>
        <button type="button" aria-label={`Stop ${tko_watcher.displayName} watching`} disabled={tko_pending} onClick={() => tko_onRemove(tko_watcher.memberId)} className="text-[#98a2b3] hover:text-[#b42318] disabled:opacity-50"><EyeOff className="h-3 w-3" /></button>
      </span>)}
      {!tko_watchers.length ? <p className="text-xs text-[#98a2b3]">Nobody is watching this task yet.</p> : null}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {tko_currentMemberId && !tko_isWatching ? <button type="button" disabled={tko_pending} onClick={tko_onWatchSelf} className="inline-flex h-7 items-center gap-1 border border-[#b3d4ff] px-2 text-[11px] font-semibold text-[#0c66e4] hover:bg-[#deebff] disabled:cursor-wait disabled:opacity-60"><Eye className="h-3.5 w-3.5" />Watch this task</button> : null}
      {tko_nonWatcherMembers.length ? <label className="inline-flex h-7 items-center gap-1 text-[11px] text-[#667085]"><UserPlus className="h-3.5 w-3.5" />
        <select aria-label="Add another watcher" value="" disabled={tko_pending} onChange={tko_event => { if (tko_event.target.value) tko_onAddMember(tko_event.target.value); }} className="h-7 border border-[#d0d5dd] bg-white px-1 text-[11px] text-[#344054] outline-none focus:border-[#0c66e4] disabled:opacity-60">
          <option value="">Add watcher…</option>
          {tko_nonWatcherMembers.map(tko_member => <option key={tko_member.id} value={tko_member.id}>{tko_member.displayName}</option>)}
        </select>
      </label> : null}
    </div>
  </div>;
}
