// Domain-focused re-export — task operations
export {
  createTask,
  getTaskById,
  updateTaskStatus,
  completeTask,
  completeTaskWithMeta,
  getRecentTasks,
  clearProjectTasks
} from "./queries.js";
