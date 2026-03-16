import { createNotification } from "../db/queries.js";

export function notifyProject(projectId, { kind = "info", title = "", message, metadata = null } = {}) {
  try {
    return createNotification({
      projectId,
      kind,
      title,
      message,
      metadata
    });
  } catch (error) {
    console.warn("[Notifier] Failed to create notification:", error.message);
    return null;
  }
}
