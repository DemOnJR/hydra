import * as React from "react";

function formatClock(value) {
  const d = new Date(value || Date.now());
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getEventIcon(kind) {
  switch (kind) {
    case "info": return "ℹ️";
    case "done": return "✅";
    case "error": return "❌";
    case "working": return "⚙️";
    case "delegated": return "📤";
    default: return "💬";
  }
}

export function NotificationFeed({ events = [] }) {
  const [open, setOpen] = React.useState(false);
  const [seenCount, setSeenCount] = React.useState(0);
  const [filter, setFilter] = React.useState("all");
  const ref = React.useRef(null);

  const filteredEvents = events.filter(ev => {
    if (filter === "all") return true;
    if (filter === "error") return ev.kind === "error";
    if (filter === "done") return ev.kind === "done";
    if (filter === "working") return ev.kind === "working" || ev.kind === "delegated";
    return true;
  });

  const unread = Math.max(0, events.length - seenCount);

  function handleOpen() {
    setOpen(v => !v);
    if (!open) setSeenCount(events.length);
  }

  // Close on outside click
  React.useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        className={`relative p-2.5 rounded-xl border transition-all shadow-sm flex items-center justify-center ${
          open 
            ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" 
            : "bg-zinc-800 border-white/5 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
        }`}
        onClick={handleOpen}
        title="Activity feed"
      >
        <span className="text-lg">🔔</span>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 border-2 border-zinc-950 min-w-[18px] text-center leading-none shadow-lg">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 right-0 w-80 max-h-[480px] bg-zinc-900 border border-white/10 rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          <div className="flex items-center justify-between p-4 border-b border-white/5 bg-zinc-900/80 backdrop-blur-md sticky top-0 z-10">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Activity</span>
            <div className="flex gap-1.5">
              {["all", "error", "done"].map(f => (
                <button 
                  key={f}
                  className={`text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${
                    filter === f 
                      ? "bg-indigo-500/20 text-indigo-400" 
                      : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300"
                  }`}
                  onClick={() => setFilter(f)}
                >
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-y-auto flex-1 divide-y divide-white/5">
            {filteredEvents.length === 0 ? (
              <p className="p-8 text-center text-zinc-500 text-xs italic">No matching activity.</p>
            ) : (
              [...filteredEvents].reverse().slice(0, 40).map(ev => (
                <div key={ev.id} className={`flex gap-3 p-4 hover:bg-white/[0.02] transition-colors ${
                  ev.kind === "error" ? "bg-red-500/5" : ev.kind === "done" ? "bg-emerald-500/5" : ""
                }`}>
                  <span className="text-base shrink-0">{getEventIcon(ev.kind)}</span>
                  <div className="grid gap-1 min-w-0">
                    <p className={`text-xs leading-relaxed break-words ${
                      ev.kind === "error" ? "text-red-400" : ev.kind === "done" ? "text-emerald-400" : "text-zinc-300"
                    }`}>
                      {ev.message}
                    </p>
                    <span className="text-[10px] text-zinc-500 font-medium uppercase tracking-tight">
                      {ev.label} · {formatClock(ev.timestamp)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
