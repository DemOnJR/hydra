import * as React from "react";

export function ProjectSettings({ activeProject, onUpdateProject }) {
  const [description, setDescription] = React.useState("");
  const [rootPath, setRootPath] = React.useState("");
  const [mode, setMode] = React.useState("manual");
  const [saving, setSaving] = React.useState(false);
  const [message, setMessage] = React.useState(null);

  React.useEffect(() => {
    if (activeProject) {
      setDescription(activeProject.description || "");
      setRootPath(activeProject.root_path || "");
      setMode(activeProject.mode || "manual");
      setMessage(null);
    }
  }, [activeProject]);

  if (!activeProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-zinc-900/50 border border-white/5 rounded-3xl">
        <span className="text-4xl mb-4">📁</span>
        <h2 className="text-lg font-black text-zinc-100 uppercase tracking-tighter">No Project Selected</h2>
        <p className="text-zinc-500 text-xs mt-2 max-w-xs">Select a project from the sidebar to configure its environment and automation settings.</p>
      </div>
    );
  }

  async function handleSelectFolder() {
    try {
      const result = await window.agentSync.selectFolder();
      if (result) setRootPath(result);
    } catch (e) {}
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateProject(activeProject.id, {
        description: description.trim(),
        rootPath: rootPath.trim(),
        mode
      });
      setMessage({ type: "success", text: "Settings updated successfully." });
    } catch (err) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto custom-scrollbar pr-2 flex flex-col gap-6 animate-in fade-in duration-500">
      <div className="bg-zinc-900/50 border border-white/5 rounded-3xl p-8 shadow-2xl">
        <div className="flex items-center gap-4 mb-8 shrink-0">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 flex items-center justify-center text-indigo-400 text-xl shadow-inner">⚙️</div>
          <div>
            <h2 className="text-xl font-black text-zinc-100 uppercase tracking-tighter leading-none">Project Environment</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] mt-2">Configure workspace path and automation level</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Implementation Mode</label>
              <div className="grid grid-cols-3 gap-2 p-1 bg-zinc-950 rounded-2xl border border-white/5 shadow-inner">
                {["manual", "semi-auto", "full-auto"].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`py-2 text-[10px] font-black uppercase tracking-tighter rounded-xl transition-all ${
                      mode === m 
                        ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                        : "text-zinc-600 hover:text-zinc-400 hover:bg-white/5"
                    }`}
                  >
                    {m.replace("-", " ")}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-zinc-600 px-1 mt-1">
                {mode === "manual" && "• Orchestrator only suggests changes. No code is written automatically."}
                {mode === "semi-auto" && "• Orchestrator can create files but requires approval for deletions/execs."}
                {mode === "full-auto" && "• Orchestrator has full write access to the workspace root."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 text-indigo-400/80">Project Description</label>
              <textarea
                className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner min-h-[120px] resize-none leading-relaxed"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this project about? Technical goals, specific rules, or important context..."
              />
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Workspace Root Path</label>
              <div className="flex gap-2">
                <input
                  className="flex-1 bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner font-mono truncate"
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  placeholder="Select folder..."
                />
                <button 
                  type="button" 
                  className="px-5 py-3 bg-zinc-800 border border-white/5 rounded-2xl text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200 transition-all shadow-lg active:scale-95" 
                  onClick={handleSelectFolder}
                >
                  📁
                </button>
              </div>
              <p className="text-[10px] text-zinc-600 px-1 mt-1">IMPORTANT: Ensure this path is correct before running the orchestrator.</p>
            </div>

            <div className="bg-white/[0.02] border border-dashed border-white/5 rounded-3xl p-6 mt-auto">
              <h3 className="text-xs font-black text-zinc-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                Audit Logs
              </h3>
              <p className="text-xs text-zinc-500 leading-relaxed">System diagnostics and project audit features coming soon. You'll be able to run deep-scan checks on your codebase here.</p>
            </div>
          </div>

          <div className="lg:col-span-2 flex items-center justify-between gap-6 pt-6 border-t border-white/5 mt-4">
            <div className="flex-1 min-w-0">
              {message && (
                <div className={`text-xs font-bold uppercase tracking-widest animate-in slide-in-from-left-2 duration-300 ${
                  message.type === "success" ? "text-emerald-500" : "text-red-500"
                }`}>
                  {message.type === "success" ? "✓" : "⚠️"} {message.text}
                </div>
              )}
            </div>
            
            <button 
              type="submit" 
              className="bg-indigo-600 text-white px-10 py-4 text-xs font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-600/20 active:scale-95 shrink-0"
              disabled={saving}
            >
              {saving ? "Synchronizing..." : "Save Workspace Settings"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
