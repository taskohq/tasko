import { type FormEvent, useState } from "react";
import { Clock3, Trash2 } from "lucide-react";

export type TkoTimeLogRow = { id: string; memberId: string; minutes: number; startedAt: Date; note: string };

function tko_minutesLabel(tko_minutes: number) {
  const tko_hours = Math.floor(tko_minutes / 60);
  const tko_rest = tko_minutes % 60;
  return tko_hours ? `${tko_hours}h ${tko_rest ? `${tko_rest}m` : ""}`.trim() : `${tko_rest}m`;
}

/** Manual time log entries with the running total, per PRD 07 §12. */
export function TkoTimeLogsPanel({ tko_logs, tko_totalMinutes, tko_pending, tko_onAdd, tko_onDelete }: {
  tko_logs: TkoTimeLogRow[];
  tko_totalMinutes: number;
  tko_pending: boolean;
  tko_onAdd: (tko_input: { minutes: number; startedAt: Date | null; note: string }) => void;
  tko_onDelete: (tko_timeLogId: string) => void;
}) {
  const [tko_minutes, setTkoMinutes] = useState("");
  const [tko_startedAt, setTkoStartedAt] = useState("");
  const [tko_note, setTkoNote] = useState("");
  const tko_submit = (tko_event: FormEvent) => {
    tko_event.preventDefault();
    const tko_parsed = Number(tko_minutes.trim());
    if (!Number.isInteger(tko_parsed) || tko_parsed <= 0) return;
    tko_onAdd({ minutes: tko_parsed, startedAt: tko_startedAt ? new Date(`${tko_startedAt}T12:00:00`) : null, note: tko_note.trim() });
    setTkoMinutes("");
    setTkoStartedAt("");
    setTkoNote("");
  };
  return <div className="space-y-2">
    <p className="text-xs font-semibold text-[#344054]">Logged {tko_minutesLabel(tko_totalMinutes)} across {tko_logs.length} entr{tko_logs.length === 1 ? "y" : "ies"}</p>
    {tko_logs.length ? <ul className="space-y-1">{tko_logs.map(tko_log => <li key={tko_log.id} className="flex items-center gap-2 border border-[#e4e7ec] bg-[#fcfcfd] px-2.5 py-1.5">
      <Clock3 className="h-3.5 w-3.5 shrink-0 text-[#5b51e8]" />
      <span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-[#344054]">{tko_minutesLabel(tko_log.minutes)}</span><span className="block truncate text-[11px] text-[#667085]">{tko_log.startedAt.toLocaleDateString()}{tko_log.note ? ` · ${tko_log.note}` : ""}</span></span>
      <button type="button" aria-label={`Delete ${tko_minutesLabel(tko_log.minutes)} entry`} disabled={tko_pending} onClick={() => tko_onDelete(tko_log.id)} className="grid h-7 w-7 shrink-0 place-items-center border border-[#fecdca] text-[#b42318] hover:bg-[#fef3f2] disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
    </li>)}</ul> : <p className="text-xs text-[#98a2b3]">No time logged yet.</p>}
    <form onSubmit={tko_submit} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-2">
      <label className="sr-only" htmlFor="time-log-minutes">Minutes</label>
      <input id="time-log-minutes" type="number" min="1" step="1" value={tko_minutes} onChange={tko_event => setTkoMinutes(tko_event.target.value)} placeholder="Minutes" className="h-8 w-full border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" />
      <label className="sr-only" htmlFor="time-log-date">Date</label>
      <input id="time-log-date" type="date" value={tko_startedAt} onChange={tko_event => setTkoStartedAt(tko_event.target.value)} className="h-8 w-full border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" />
      <button type="submit" disabled={tko_pending || !tko_minutes.trim()} className="h-8 bg-[#0c66e4] px-2.5 text-[11px] font-semibold text-white hover:bg-[#0055cc] disabled:cursor-not-allowed disabled:opacity-60">Log</button>
      <label className="sr-only" htmlFor="time-log-note">Note</label>
      <input id="time-log-note" value={tko_note} onChange={tko_event => setTkoNote(tko_event.target.value)} placeholder="Note (optional)" className="col-span-3 h-8 w-full border border-[#d0d5dd] px-2 text-xs text-[#344054] outline-none focus:border-[#0c66e4]" />
    </form>
  </div>;
}
