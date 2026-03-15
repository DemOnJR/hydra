import { useEffect, useState } from "react";
import { request } from "../api.js";

export function useProjectTasks(serverUrl, activeProjectId) {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function loadTasks() {
      if (!serverUrl || !activeProjectId) {
        if (!cancelled) {
          setTasks([]);
        }
        return;
      }

      try {
        const nextTasks = await request(
          serverUrl,
          `/api/tasks?projectId=${encodeURIComponent(activeProjectId)}&limit=50`
        );

        if (!cancelled) {
          setTasks(nextTasks);
        }
      } catch {
        if (!cancelled) {
          setTasks([]);
        }
      }
    }

    loadTasks();
    intervalId = window.setInterval(loadTasks, 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [serverUrl, activeProjectId]);

  return {
    tasks
  };
}
