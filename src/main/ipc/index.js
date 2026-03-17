// Central re-export — all IPC-related exports
export { runAgentTask } from "./agentTasks.js";
export { registerIpcHandlers } from "./register.js";
export { emitTaskEvent, recordFileChanges, formatHydraChangeSummary, appendHydraChangeSummary } from "./taskEvents.js";
