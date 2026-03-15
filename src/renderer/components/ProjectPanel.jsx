import { useEffect, useState } from "react";

export function ProjectPanel({
  projects,
  activeProject,
  activeProjectId,
  loading,
  onCreateProject,
  onActivateProject,
  onUpdateProject,
  onDeleteProject
}) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [mode, setMode] = useState("manual");
  const [creating, setCreating] = useState(false);

  const [editDescription, setEditDescription] = useState("");
  const [editRootPath, setEditRootPath] = useState("");
  const [editMode, setEditMode] = useState("manual");

  useEffect(() => {
    setEditDescription(activeProject?.description || "");
    setEditRootPath(activeProject?.root_path || "");
    setEditMode(activeProject?.mode || "manual");
  }, [activeProject]);

  async function handleSelectFolder() {
    try {
      const result = await window.agentSync.selectFolder();
      if (result) setRootPath(result);
    } catch {
      // dialog cancelled
    }
  }

  async function handleSelectEditFolder() {
    try {
      const result = await window.agentSync.selectFolder();
      if (result) setEditRootPath(result);
    } catch {
      // dialog cancelled
    }
  }

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateProject({
        name: name.trim(),
        description: description.trim(),
        rootPath: rootPath.trim(),
        mode
      });
      setName("");
      setDescription("");
      setRootPath("");
      setMode("manual");
      setShowModal(false);
    } finally {
      setCreating(false);
    }
  }

  async function handleUpdate(event) {
    event.preventDefault();
    if (!activeProjectId) return;
    await onUpdateProject(activeProjectId, {
      description: editDescription.trim(),
      rootPath: editRootPath.trim(),
      mode: editMode
    });
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Projects</h2>
        {loading ? <span className="pill">Syncing</span> : null}
      </div>

      <button
        type="button"
        className="project-new-btn"
        onClick={() => setShowModal(true)}
      >
        <span>＋</span> New project
      </button>

      <div className="list">
        {projects.length === 0 ? (
          <p className="empty-state">No projects yet.</p>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="project-list-row">
              <button
                type="button"
                className={project.id === activeProjectId ? "list-item active" : "list-item"}
                onClick={() => onActivateProject(project.id)}
              >
                <span>{project.name}</span>
                {project.is_active ? <span className="pill success">Active</span> : null}
              </button>
              <button
                type="button"
                className="delete-project-btn"
                title="Delete project"
                onClick={() => {
                  if (window.confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                    onDeleteProject(project.id);
                  }
                }}
              >✕</button>
            </div>
          ))
        )}
      </div>

      {activeProject ? (
        <form className="stack-form project-settings-form" onSubmit={handleUpdate}>
          <div className="panel-header">
            <h2>Settings</h2>
            <span className="pill">{activeProject.mode || "manual"}</span>
          </div>
          <textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            placeholder="Project description"
            rows={2}
          />
          <div className="modal-field">
            <div className="folder-picker">
              <input
                value={editRootPath}
                onChange={(e) => setEditRootPath(e.target.value)}
                placeholder="Root path"
              />
              <button type="button" className="folder-btn" onClick={handleSelectEditFolder}>
                📁
              </button>
            </div>
          </div>
          <select value={editMode} onChange={(e) => setEditMode(e.target.value)}>
            <option value="manual">manual</option>
            <option value="semi-auto">semi-auto</option>
            <option value="full-auto">full-auto</option>
          </select>
          <button type="submit">Save</button>
        </form>
      ) : null}

      {showModal ? (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="modal">
            <div className="modal-header">
              <h2>New Project</h2>
              <button type="button" className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="modal-field">
              <label className="modal-label">Project name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My App"
                autoFocus
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description (optional)"
                rows={2}
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">Root folder</label>
              <div className="folder-picker">
                <input
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  placeholder="Select or type path…"
                />
                <button type="button" className="folder-btn" onClick={handleSelectFolder}>
                  📁 Browse
                </button>
              </div>
            </div>

            <div className="modal-field">
              <label className="modal-label">Mode</label>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="manual">manual</option>
                <option value="semi-auto">semi-auto</option>
                <option value="full-auto">full-auto</option>
              </select>
            </div>

            <div className="modal-actions">
              <button type="button" className="ghost-button" onClick={() => setShowModal(false)}>Cancel</button>
              <button type="button" onClick={handleCreate} disabled={creating || !name.trim()}>
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
