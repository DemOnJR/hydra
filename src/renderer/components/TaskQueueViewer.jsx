import * as React from "react";

function formatClock(value) {
  const d = new Date(value || 0);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(text, max = 80) {
  const s = String(text || "").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const STATUS_LABEL = { pending: "pending", sent: "sent", working: "working", done: "done", error: "error" };
const STATUS_CLASS = { 
  pending: "bg-amber-500/10 text-amber-500 border border-amber-500/20", 
  sent: "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20", 
  working: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 animate-pulse", 
  done: "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20", 
  error: "bg-red-500/10 text-red-500 border border-red-500/20" 
};

function TaskRow({ task, agentName }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] transition-colors last:border-0">
      <td className="px-4 py-3 font-bold text-zinc-200">{agentName}</td>
      <td className="px-4 py-3 text-zinc-400 align-middle italic truncate max-w-md">{truncate(task.user_task)}</td>
      <td className="px-4 py-3 align-middle">
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border ${STATUS_CLASS[task.status] || STATUS_CLASS.pending}`}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
      </td>
      <td className="px-4 py-3 text-[10px] text-zinc-600 font-medium tabular-nums">{formatClock(task.created_at)}</td>
      <td className="px-4 py-3 text-[10px] text-zinc-600 font-medium tabular-nums">{task.completed_at ? formatClock(task.completed_at) : "—"}</td>
    </tr>
  );
}

function Section({ title, tasks, agents, defaultOpen = true }) {
  const [open, setOpen] = React.useState(defaultOpen);
  const agentMap = Object.fromEntries((agents || []).map(a => [a.id, a.name]));

  return (
    <div className="bg-zinc-900/50 border border-white/5 rounded-xl overflow-hidden shadow-sm">
      <button type="button" className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-800/50 text-zinc-100 text-[10px] font-bold uppercase tracking-widest hover:bg-zinc-800 transition-colors" onClick={() => setOpen(v => !v)}>
        <span className="text-zinc-500 w-4 text-center">{open ? "▼" : "▶"}</span>
        <span>{title}</span>
        <span className="ml-auto bg-zinc-950 text-zinc-500 rounded-full px-2 py-0.5 text-[10px] border border-white/5 font-bold shadow-inner">{tasks.length}</span>
      </button>
      {open && (
        <div className="overflow-x-auto">
          {tasks.length === 0 ? (
            <p className="p-4 text-zinc-600 text-[10px] uppercase font-bold tracking-widest italic bg-zinc-950/20">None</p>
          ) : (
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="px-4 py-2 text-left text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 bg-zinc-950/30">Agent</th>
                  <th className="px-4 py-2 text-left text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 bg-zinc-950/30">Task</th>
                  <th className="px-4 py-2 text-left text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 bg-zinc-950/30">Status</th>
                  <th className="px-4 py-2 text-left text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 bg-zinc-950/30">Created</th>
                  <th className="px-4 py-2 text-left text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 bg-zinc-950/30">Done</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <TaskRow key={task.id} task={task} agentName={agentMap[task.agent_id] || task.agent_name || "?"} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskQueueViewer({ tasks = [], agents = [], onClear }) {
  const [showClearConfirm, setShowClearConfirm] = React.useState(false);

  function handleClearClick() {
    setShowClearConfirm(true);
  }

  function handleClearConfirm() {
    setShowClearConfirm(false);
    if (onClear) {
      onClear();
    }
  }

  function handleClearCancel() {
    setShowClearConfirm(false);
  }

  if (tasks.length === 0 && !onClear) {
    return (
      <div className="flex flex-col gap-4 py-1">
        <div className="p-12 text-center text-zinc-500 text-sm bg-zinc-900/50 border border-dashed border-white/5 rounded-2xl italic shadow-inner">
          <p>No tasks yet. Send a message to the orchestrator to get started.</p>
        </div>
      </div>
    );
  }

  const active = tasks.filter(t => ["pending", "sent", "working"].includes(t.status));
  const done = tasks.filter(t => t.status === "done").slice(-20).reverse();
  const errors = tasks.filter(t => t.status === "error");
  const hasItems = active.length > 0 || done.length > 0 || errors.length > 0;

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex justify-end">
        {hasItems && onClear && (
          <button type="button" className="px-3 py-1.5 bg-zinc-800 text-zinc-400 text-[10px] font-bold uppercase tracking-widest rounded-lg border border-white/5 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all shadow-sm flex items-center gap-2" onClick={handleClearClick}>
            <span>🗑️</span> Clear Queue
          </button>
        )}
      </div>
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-full max-w-xs shadow-2xl flex flex-col gap-4 text-center animate-in zoom-in-95 duration-200">
            <div className="text-3xl mb-1">🧹</div>
            <div className="grid gap-1">
              <p className="text-zinc-100 font-bold">Clear all tasks and logs?</p>
              <p className="text-xs text-zinc-500 leading-relaxed">This will reset all agent statuses and clear the history for this session.</p>
            </div>
            <div className="flex gap-2 mt-2">
              <button type="button" className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 text-xs font-bold rounded-lg hover:bg-zinc-700 transition-colors" onClick={handleClearCancel}>
                Cancel
              </button>
              <button type="button" className="flex-1 px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-500 transition-colors shadow-lg shadow-red-600/20" onClick={handleClearConfirm}>
                Clear all
              </button>
            </div>
          </div>
        </div>
      )}
      {tasks.length === 0 ? (
        <div className="p-12 text-center text-zinc-500 text-sm bg-zinc-900/50 border border-dashed border-white/5 rounded-2xl italic shadow-inner">
          <p>No tasks yet. Send a message to the orchestrator to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Section title="Active Tasks" tasks={active} agents={agents} defaultOpen={true} />
          {errors.length > 0 && <Section title="Recent Errors" tasks={errors} agents={agents} defaultOpen={true} />}
          <Section title="Completed" tasks={done} agents={agents} defaultOpen={false} />
        </div>
      )}
    </div>
  );
}
