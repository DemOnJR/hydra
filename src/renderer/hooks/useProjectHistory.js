import * as React from "react";
import { request } from "../api.js";

const EMPTY_HISTORY = {
  memory: {
    orchestrator_summary: "",
    worker_summary: "",
    shared_summary: "",
    recent_changes: "",
    updated_at: ""
  },
  sessions: [],
  orchestratorTurns: [],
  workerTurns: []
};

export function useProjectHistory(serverUrl, activeProjectId) {
  const [history, setHistory] = React.useState(EMPTY_HISTORY);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function loadHistory() {
      if (!serverUrl || !activeProjectId) {
        if (!cancelled) {
          setHistory(EMPTY_HISTORY);
        }
        return;
      }

      if (!cancelled) {
        setLoading(true);
      }

      try {
        const nextHistory = await request(
          serverUrl,
          `/api/context/${encodeURIComponent(activeProjectId)}/history?limit=20`
        );

        if (!cancelled) {
          setHistory({
            ...EMPTY_HISTORY,
            ...nextHistory
          });
        }
      } catch {
        if (!cancelled) {
          setHistory(EMPTY_HISTORY);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadHistory();
    intervalId = window.setInterval(loadHistory, 5000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [serverUrl, activeProjectId]);

  return {
    loading,
    memory: history.memory || EMPTY_HISTORY.memory,
    sessions: history.sessions || [],
    orchestratorTurns: history.orchestratorTurns || [],
    workerTurns: history.workerTurns || []
  };
}
