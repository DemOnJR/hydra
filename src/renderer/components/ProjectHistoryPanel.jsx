import * as React from "react";

function trimBlock(value) {
  return String(value ?? "").trim();
}

function firstLine(value) {
  const t = trimBlock(value);
  if (!t) return null;
  return t.split("\n")[0].slice(0, 120);
}

function SessionCard({ session }) {
  const [open, setOpen] = React.useState(false);
  return (
    <article className="bg-zinc-800/50 border border-white/5 rounded-lg p-3 flex flex-col gap-2 transition-colors hover:bg-zinc-800/80 group">
      <header
        className="flex items-center justify-between gap-3 cursor-pointer"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <strong className="text-sm text-zinc-100 group-hover:text-indigo-400 transition-colors">{session.agent_name}</strong>
          <div className="text-[10px] text-zinc-500 font-medium uppercase tracking-tight">
            {session.agent_role} · {session.platform}
            {session.specialty ? ` · ${session.specialty}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            session.status === "done" ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border border-white/5"
          }`}>{session.status}</span>
          <span className="text-[10px] text-zinc-600 font-bold w-4 text-center">{open ? "▲" : "▼"}</span>
        </div>
      </header>
      {open && (
        <div className="grid gap-3 mt-1 pt-3 border-t border-white/5 animate-in slide-in-from-top-1 duration-200">
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Asked</span>
            <p className="text-xs text-zinc-300 leading-relaxed italic border-l-2 border-indigo-500/30 pl-3 py-0.5">{session.user_task}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Result</span>
            <div className="text-xs text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed bg-zinc-950/50 p-3 rounded-md border border-white/5">
              {trimBlock(session.response) || "No response saved yet."}
            </div>
          </div>
        </div>
      )}
      {!open && (
        <div className="text-xs text-zinc-500 truncate italic pl-1 border-l border-white/10 mt-0.5">
          {session.user_task || "—"}
        </div>
      )}
    </article>
  );
}

const MEMORY_FIELDS = [
  { key: "shared_summary", label: "Shared Context" },
  { key: "orchestrator_summary", label: "Orchestrator" },
  { key: "worker_summary", label: "Workers" },
  { key: "recent_changes", label: "Changes" },
];

export function ProjectHistoryPanel({ activeProject, history, loading }) {
  const [tab, setTab] = React.useState("overview");

  if (!activeProject?.id) {
    return (
      <section className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Project Memory</h2>
        </div>
        <p className="text-zinc-500 text-xs py-8 text-center italic">Select a project to load orchestrator history.</p>
      </section>
    );
  }

  const updatedAt = trimBlock(history.memory.updated_at)
    ? new Date(history.memory.updated_at).toLocaleString()
    : null;

  const activeFields = MEMORY_FIELDS.filter((f) => trimBlock(history.memory[f.key]));

  return (
    <section className="bg-zinc-900/50 border border-white/5 rounded-xl p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest">Project Memory</h2>
        <div className="flex items-center gap-3">
          {loading && <span className="inline-flex items-center rounded-full px-2 py-0.5 bg-indigo-500/10 text-indigo-400 text-[10px] font-bold uppercase tracking-wider border border-indigo-500/20 animate-pulse">Refreshing</span>}
          {updatedAt && <span className="text-[10px] font-medium text-zinc-600 uppercase tracking-tighter tabular-nums">Last updated: {updatedAt}</span>}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 p-1 bg-zinc-950/50 rounded-lg border border-white/5">
        {["overview", "details", "sessions"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest rounded-md transition-all ${
              tab === t 
                ? "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" 
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB — compact pills */}
      {tab === "overview" && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          {activeFields.length === 0 ? (
            <p className="text-zinc-500 text-xs py-8 text-center italic">Start talking to the orchestrator and Hydra will build memory here.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {activeFields.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{f.label}</span>
                  <div className="text-xs text-zinc-300 truncate bg-zinc-800/40 px-3 py-2 rounded-lg border-l-2 border-indigo-500/50 border-white/5 group-hover:bg-zinc-800/60 transition-colors">
                    {firstLine(history.memory[f.key])}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setTab("details")}
                className="self-start mt-2 px-3 py-1 text-[10px] font-bold uppercase tracking-wider border border-white/5 rounded-full text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/30 transition-all"
              >
                View full memory →
              </button>
            </div>
          )}
        </div>
      )}

      {/* DETAILS TAB — full text */}
      {tab === "details" && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          {MEMORY_FIELDS.map((f) => (
            <div key={f.key} className="bg-zinc-800/30 border border-white/5 rounded-lg p-3 flex flex-col gap-2">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{f.label}</span>
              <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto custom-scrollbar pr-2">
                {trimBlock(history.memory[f.key]) || <span className="italic text-zinc-700">Empty</span>}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* SESSIONS TAB */}
      {tab === "sessions" && (
        <div className="flex flex-col gap-3 animate-in fade-in duration-300">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{history.sessions.length} saved sessions</span>
          </div>
          {history.sessions.length === 0 ? (
            <p className="text-zinc-500 text-xs py-8 text-center italic">No task sessions stored yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {history.sessions.slice(0, 10).map((session) => (
                <SessionCard key={session.task_id} session={session} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
