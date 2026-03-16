import * as React from "react";

export function ProjectPanel({
  projects,
  activeProjectId,
  loading,
  onCreateProject,
  onActivateProject,
  onDeleteProject
}) {
  const [showModal, setShowModal] = React.useState(false);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [rootPath, setRootPath] = React.useState("");
  const [mode, setMode] = React.useState("manual");
  const [creating, setCreating] = React.useState(false);

  async function handleSelectFolder() {
    try {
      const result = await window.agentSync.selectFolder();
      if (result) setRootPath(result);
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

  return (
    <section className="flex flex-col gap-4">
      <button
        type="button"
        className="w-full bg-indigo-600 text-white rounded-xl p-3 text-xs font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2 hover:bg-indigo-500 transition-all shadow-lg shadow-indigo-600/20 active:scale-95 shrink-0"
        onClick={() => setShowModal(true)}
      >
        <span className="text-lg leading-none">+</span> New project
      </button>

      <div className="flex flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
        {projects.length === 0 ? (
          <p className="text-zinc-600 text-[10px] font-bold uppercase tracking-widest py-8 text-center border border-dashed border-white/5 rounded-xl">No projects</p>
        ) : (
          projects.map((project) => (
            <div key={project.id} className="flex items-center gap-1 group">
              <button
                type="button"
                className={`flex-1 flex items-center justify-between px-4 py-3 rounded-xl text-xs font-bold transition-all border ${
                  project.id === activeProjectId 
                    ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-sm" 
                    : "text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300 border-transparent"
                }`}
                onClick={() => onActivateProject(project.id)}
              >
                <span className="truncate pr-2">{project.name}</span>
                {project.id === activeProjectId && (
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.6)] shrink-0" />
                )}
              </button>
              
              <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="p-2.5 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all border border-transparent hover:border-red-500/20"
                  title="Delete project"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete "${project.name}"?`)) {
                      onDeleteProject(project.id);
                    }
                  }}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
                    <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="bg-zinc-900 border border-white/10 rounded-[32px] p-8 w-full max-w-md shadow-2xl flex flex-col gap-6 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between">
              <div className="grid gap-1">
                <h2 className="text-2xl font-black text-zinc-100 tracking-tighter leading-none">New Project</h2>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">Workspace Creation</p>
              </div>
              <button type="button" className="w-10 h-10 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-red-500/20 hover:text-red-400 transition-all shadow-lg active:scale-90" onClick={() => setShowModal(false)}>✕</button>
            </div>

            <div className="grid gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Project Name *</label>
                <input
                  className="w-full bg-zinc-950 border border-white/5 rounded-[5px] px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Project Hydra"
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Root Folder</label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 bg-zinc-950 border border-white/5 rounded-[5px] px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                    placeholder="Select or type path…"
                  />
                  <button type="button" className="px-4 py-3 bg-zinc-800 border border-white/5 rounded-[5px] text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-colors flex items-center gap-2" onClick={handleSelectFolder}>
                    📁
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <button 
                type="button" 
                className="w-full bg-indigo-600 text-white p-4 text-xs font-black uppercase tracking-[0.2em] rounded-[5px] hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                onClick={handleCreate} 
                disabled={creating || !name.trim()}
              >
                {creating ? "Initializing..." : "Create Workspace"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
