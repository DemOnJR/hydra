import { useState } from "react";

function trimBlock(value) {
  return String(value ?? "").trim();
}

function firstLine(value) {
  const t = trimBlock(value);
  if (!t) return null;
  return t.split("\n")[0].slice(0, 120);
}

function SessionCard({ session }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="history-session-card">
      <header
        className="history-session-header"
        style={{ cursor: "pointer" }}
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <strong>{session.agent_name}</strong>
          <div className="agent-meta">
            {session.agent_role} | {session.platform}
            {session.specialty ? ` | ${session.specialty}` : ""}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pill">{session.status}</span>
          <span style={{ fontSize: 11, opacity: 0.5 }}>{open ? "▲" : "▼"}</span>
        </div>
      </header>
      {open && (
        <>
          <div className="history-session-block">
            <span className="eyebrow">Asked</span>
            <p>{session.user_task}</p>
          </div>
          <div className="history-session-block">
            <span className="eyebrow">Result</span>
            <p>{trimBlock(session.response) || "No response saved yet."}</p>
          </div>
        </>
      )}
      {!open && (
        <div style={{ padding: "4px 0 2px", fontSize: 12, opacity: 0.65, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {session.user_task?.slice(0, 100) || "—"}
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
  const [tab, setTab] = useState("overview");

  if (!activeProject?.id) {
    return (
      <section className="panel history-panel">
        <div className="panel-header">
          <h2>Project Memory</h2>
        </div>
        <p className="empty-state">Select a project to load orchestrator history.</p>
      </section>
    );
  }

  const updatedAt = trimBlock(history.memory.updated_at)
    ? new Date(history.memory.updated_at).toLocaleString()
    : null;

  const activeFields = MEMORY_FIELDS.filter((f) => trimBlock(history.memory[f.key]));

  return (
    <section className="panel history-panel">
      <div className="panel-header">
        <h2>Project Memory</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {loading && <span className="pill working">Refreshing</span>}
          {updatedAt && <span style={{ fontSize: 11, opacity: 0.45 }}>{updatedAt}</span>}
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 4, padding: "0 0 10px 0", borderBottom: "1px solid var(--border)" }}>
        {["overview", "details", "sessions"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "4px 12px",
              borderRadius: 20,
              border: "none",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: tab === t ? 600 : 400,
              background: tab === t ? "var(--accent, #6c63ff)" : "var(--surface2, rgba(255,255,255,0.07))",
              color: tab === t ? "#fff" : "inherit",
              opacity: tab === t ? 1 : 0.6,
              transition: "all 0.15s",
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB — compact pills */}
      {tab === "overview" && (
        <div style={{ paddingTop: 12 }}>
          {activeFields.length === 0 ? (
            <p className="empty-state">Start talking to the orchestrator and Hydra will build memory here.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {activeFields.map((f) => (
                <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="eyebrow">{f.label}</span>
                  <div style={{
                    fontSize: 12,
                    opacity: 0.8,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    padding: "5px 8px",
                    background: "var(--surface2, rgba(255,255,255,0.05))",
                    borderRadius: 6,
                    borderLeft: "3px solid var(--accent, #6c63ff)",
                  }}>
                    {firstLine(history.memory[f.key])}
                  </div>
                </div>
              ))}
              <button
                onClick={() => setTab("details")}
                style={{
                  alignSelf: "flex-start",
                  marginTop: 4,
                  padding: "3px 10px",
                  fontSize: 11,
                  border: "1px solid var(--border)",
                  borderRadius: 12,
                  background: "transparent",
                  cursor: "pointer",
                  opacity: 0.6,
                }}
              >
                View full memory →
              </button>
            </div>
          )}
        </div>
      )}

      {/* DETAILS TAB — full text */}
      {tab === "details" && (
        <div style={{ paddingTop: 12, display: "flex", flexDirection: "column", gap: 14 }}>
          {MEMORY_FIELDS.map((f) => (
            <div key={f.key} className="history-card">
              <span className="eyebrow">{f.label}</span>
              <pre className="history-pre">
                {trimBlock(history.memory[f.key]) || "—"}
              </pre>
            </div>
          ))}
        </div>
      )}

      {/* SESSIONS TAB */}
      {tab === "sessions" && (
        <div style={{ paddingTop: 12 }}>
          <div className="action-row" style={{ marginBottom: 8 }}>
            <span className="eyebrow">{history.sessions.length} saved sessions</span>
          </div>
          {history.sessions.length === 0 ? (
            <p className="empty-state">No task sessions stored yet.</p>
          ) : (
            <div className="history-session-list">
              {history.sessions.slice(0, 8).map((session) => (
                <SessionCard key={session.task_id} session={session} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
