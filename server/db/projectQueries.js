// Domain-focused re-export — project & context operations
export {
  getAllProjects,
  getProjectById,
  getActiveProject,
  createProject,
  updateProject,
  setActiveProject,
  deleteProject,
  getProjectContext,
  updateProjectContext,
  getProjectCompaction,
  refreshProjectCompaction
} from "./queries.js";
