import { useEffect, useRef, useState } from "react";

function formatClock(value) {
  const d = new Date(value || Date.now());
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getEventIcon(kind) {
  switch (kind) {
    case "done": return "✅";
    case "error": return "❌";
    case "working": return "⚙️";
    case "delegated": return "📤";
    default: return "💬";
  }
}

export function NotificationFeed({ events = [] }) {
  const [open, setOpen] = useState(false);
  const [seenCount, setSeenCount] = useState(0);
  const ref = useRef(null);

  const unread = Math.max(0, events.length - seenCount);

  function handleOpen() {
    setOpen(v => !v);
    if (!open) setSeenCount(events.length);
  }

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="notif-root" ref={ref}>
      <button
        type="button"
        className={`notif-bell ${open ? "active" : ""}`}
        onClick={handleOpen}
        title="Activity feed"
      >
        🔔
        {unread > 0 && (
          <span className="notif-badge">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-header">
            <span className="eyebrow">Activity</span>
            <span className="pill">{events.length}</span>
          </div>
          <div className="notif-list">
            {events.length === 0 ? (
              <p className="notif-empty">No activity yet.</p>
            ) : (
              [...events].reverse().slice(0, 40).map(ev => (
                <div key={ev.id} className={`notif-item notif-item-${ev.kind}`}>
                  <span className="notif-icon">{getEventIcon(ev.kind)}</span>
                  <div className="notif-item-body">
                    <p className="notif-item-text">{ev.message}</p>
                    <span className="notif-item-meta">{ev.label} · {formatClock(ev.timestamp)}</span>
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
