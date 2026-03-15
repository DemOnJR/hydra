import { useEffect, useState } from "react";
import { request } from "../api.js";

export function useProjects(serverUrl) {
  const [projects, setProjects] = useState([]);
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshProjects() {
    if (!serverUrl) {
      return;
    }

    setLoading(true);

    try {
      const items = await request(serverUrl, "/api/projects");
      setProjects(items);
      const activeProject = items.find((project) => project.is_active);
      setActiveProjectId(activeProject?.id || null);
      setError("");
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshProjects();
  }, [serverUrl]);

  async function createProject(name, description) {
    const payload =
      typeof name === "object"
        ? name
        : {
            name,
            description
          };

    const project = await request(serverUrl, "/api/projects", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    await refreshProjects();
    return project;
  }

  async function updateProject(projectId, patch) {
    const project = await request(serverUrl, `/api/projects/${projectId}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });

    await refreshProjects();
    return project;
  }

  async function activateProject(projectId) {
    await request(serverUrl, `/api/projects/${projectId}/activate`, {
      method: "PUT"
    });
    await refreshProjects();
  }

  async function deleteProject(projectId) {
    await request(serverUrl, `/api/projects/${projectId}`, { method: "DELETE" });
    if (activeProjectId === projectId) setActiveProjectId(null);
    await refreshProjects();
  }

  return {
    projects,
    activeProjectId,
    loading,
    error,
    createProject,
    updateProject,
    activateProject,
    refreshProjects,
    deleteProject
  };
}
