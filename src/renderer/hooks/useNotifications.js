import * as React from "react";
import { request } from "../api.js";

export function useNotifications(serverUrl, activeProjectId) {
  const [notifications, setNotifications] = React.useState([]);

  React.useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    async function load() {
      if (!serverUrl || !activeProjectId) {
        if (!cancelled) {
          setNotifications([]);
        }
        return;
      }

      try {
        const items = await request(
          serverUrl,
          `/api/notifications?projectId=${encodeURIComponent(activeProjectId)}&limit=50`
        );

        if (!cancelled) {
          setNotifications(Array.isArray(items) ? items : []);
        }
      } catch {
        if (!cancelled) {
          setNotifications([]);
        }
      }
    }

    load();
    intervalId = window.setInterval(load, 4000);

    return () => {
      cancelled = true;
      if (intervalId) window.clearInterval(intervalId);
    };
  }, [serverUrl, activeProjectId]);

  return { notifications };
}
