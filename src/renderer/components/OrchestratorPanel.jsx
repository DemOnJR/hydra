import * as React from "react";
import { request } from "../api.js";

export function OrchestratorPanel({ serverUrl, activeProject }) {
  const [sessions, setSessions] = React.useState([]);
  const [selectedSessionId, setSelectedSessionId] = React.useState("");
  const [logs, setLogs] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [actionMessage, setActionMessage] = React.useState("");
  const [error, setError] = React.useState("");

  async function refreshSessions() {
    if (!serverUrl || !activeProject?.id) {
      setSessions([]);
      setLogs([]);
      return;
    }

    const items = await request(
      serverUrl,
      `/api/sessions?projectId=${activeProject.id}&limit=8`
    );
    setSessions(items);

    if (items.length > 0) {
      setSelectedSessionId((current) =>
        current && items.some((item) => item.id === current) ? current : items[0].id
      );
    } else {
      setSelectedSessionId("");
      setLogs([]);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    let intervalId;

    async function load() {
      if (!serverUrl || !activeProject?.id) {
        setSessions([]);
        setLogs([]);
        return;
      }

      try {
        await refreshSessions();
        setError("");
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      }
    }

    load();

    if (serverUrl && activeProject?.id) {
      intervalId = window.setInterval(load, 3000);
    }

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [serverUrl, activeProject?.id]);

  React.useEffect(() => {
    let cancelled = false;

    async function loadLogs() {
      if (!serverUrl || !selectedSessionId) {
        setLogs([]);
        return;
      }

      try {
        const items = await request(serverUrl, `/api/sessions/${selectedSessionId}/logs`);
        if (!cancelled) {
          setLogs(items);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError.message);
        }
      }
    }

    loadLogs();

    return () => {
      cancelled = true;
    };
  }, [serverUrl, selectedSessionId]);

  async function handleStartSession(dryRun) {
    if (!activeProject?.id) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      const session = await request(serverUrl, "/api/sessions/start", {
        method: "POST",
        body: JSON.stringify({
          projectId: activeProject.id,
          dryRun,
          maxCycles: dryRun ? 2 : 6
        })
      });

      setActionMessage(
        dryRun
          ? `Dry run started (${session.id.slice(0, 8)}).`
          : `Orchestrator started (${session.id.slice(0, 8)}).`
      );
      await refreshSessions();
    } catch (startError) {
      setError(startError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDecision(decision) {
    if (!selectedSessionId) {
      return;
    }

    setLoading(true);
    setError("");

    try {
      await request(serverUrl, `/api/sessions/${selectedSessionId}/decision`, {
        method: "PATCH",
        body: JSON.stringify({ decision })
      });
      setActionMessage(`Decision set to ${decision}.`);
      await refreshSessions();
    } catch (decisionError) {
      setError(decisionError.message);
    } finally {
      setLoading(false);
    }
  }

  const selectedSession = sessions.find((session) => session.id === selectedSessionId) || null;
  const hasRootPath = Boolean(activeProject?.root_path?.trim());

  return (
    <section className="panel orchestrator-panel">
      <div className="panel-header">
        <div>
          <h2>Orchestrator</h2>
          <p className="helper-text">
            {activeProject
              ? `Project mode: ${activeProject.mode || "manual"}`
              : "Select a project to run orchestrator sessions."}
          </p>
        </div>
        {loading ? <span className="pill">Running</span> : null}
      </div>

      {activeProject ? (
        <div className="orchestrator-actions">
          <button
            type="button"
            onClick={() => handleStartSession(true)}
            disabled={!hasRootPath || loading}
          >
            Dry run
          </button>
          <button
            type="button"
            onClick={() => handleStartSession(false)}
            disabled={!hasRootPath || loading}
          >
            Start session
          </button>
          <button type="button" className="ghost-button" onClick={refreshSessions}>
            Refresh
          </button>
        </div>
      ) : null}

      {!hasRootPath && activeProject ? (
        <p className="error-text">
          Set a valid project root path before starting the orchestrator.
        </p>
      ) : null}

      {actionMessage ? <p className="helper-text">{actionMessage}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <div className="orchestrator-grid">
        <div className="orchestrator-session-list">
          {sessions.length === 0 ? (
            <p className="empty-state">No orchestrator sessions yet.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={
                  session.id === selectedSessionId
                    ? "orchestrator-session-card active"
                    : "orchestrator-session-card"
                }
                onClick={() => setSelectedSessionId(session.id)}
              >
                <strong>{session.status}</strong>
                <span className="helper-text">{session.orchestrator_model}</span>
                <span className="helper-text">
                  cycle {session.current_cycle}/{session.max_cycles}
                </span>
                <span className="helper-text">
                  {session.summary || "No summary yet."}
                </span>
              </button>
            ))
          )}
        </div>

        <div className="orchestrator-session-detail">
          {selectedSession ? (
            <>
              <div className="panel-header">
                <div>
                  <h3>Session Detail</h3>
                  <p className="helper-text">{selectedSession.id}</p>
                </div>
                {selectedSession.status === "waiting_approval" ? (
                  <div className="agent-actions">
                    <button type="button" onClick={() => handleDecision("approved")}>
                      Approve
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => handleDecision("rejected")}
                    >
                      Reject
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="detail-grid">
                <span className="chip">{selectedSession.mode}</span>
                <span className="chip">{selectedSession.status}</span>
                <span className="chip">{selectedSession.decision}</span>
              </div>

              <p className="helper-text">
                {selectedSession.summary || "No summary yet."}
              </p>

              <div className="log-box">
                {logs.length === 0 ? (
                  <p className="empty-state">No logs yet.</p>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className={`log-line log-${log.level}`}>
                      <span className="log-time">{log.created_at}</span>
                      <span>{log.message}</span>
                    </div>
                  ))
                )}
              </div>
            </>
          ) : (
            <p className="empty-state">Select a session to inspect logs.</p>
          )}
        </div>
      </div>
    </section>
  );
}
