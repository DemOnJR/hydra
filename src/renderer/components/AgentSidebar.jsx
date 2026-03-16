import * as React from "react";

const platforms = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "ollama", label: "Ollama (Local)" },
  { value: "local", label: "Local (Direct)" }
];

const roles = [
  { value: "orchestrator", label: "Orchestrator" },
  { value: "worker", label: "Worker" }
];

export function AgentSidebar({
  agents,
  catalog = {},
  loading,
  queueCounts,
  onCreateAgent,
  onDeleteAgent,
  onUpdateAgentRole,
  onUpdateAgentSpecialty,
  onRenameAgent,
  fullPage = false
}) {
  const [showModal, setShowModal] = React.useState(false);
  const [name, setName] = React.useState("");
  const [platform, setPlatform] = React.useState(platforms[0].value);
  const [role, setRole] = React.useState(roles[1].value);
  const [specialty, setSpecialty] = React.useState("");

  // Inline name editing state
  const [editingId, setEditingId] = React.useState(null);
  const [editValue, setEditValue] = React.useState("");

  function startEdit(agent) {
    setEditingId(agent.id);
    setEditValue(agent.name);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditValue("");
  }

  async function commitEdit(agent) {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== agent.name) {
      await onRenameAgent(agent.id, trimmed);
    }
    setEditingId(null);
    setEditValue("");
  }

  async function handleCreate() {
    if (!name.trim()) {
      return;
    }

    await onCreateAgent(name.trim(), platform, role, specialty.trim());
    setName("");
    setPlatform(platforms[0].value);
    setRole(roles[1].value);
    setSpecialty("");
    setShowModal(false);
  }

  const listContainerClass = fullPage 
    ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" 
    : "flex flex-col gap-2";

  return (
    <section className={`bg-zinc-900/50 border border-white/5 rounded-2xl p-5 h-full flex flex-col ${fullPage ? "shadow-2xl" : ""}`}>
      <div className="flex items-center justify-between gap-3 mb-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400">🤖</div>
          <div>
            <h2 className="text-sm font-black text-zinc-100 uppercase tracking-tighter leading-none">Agent Management</h2>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-1">Configure and monitor your AI swarm</p>
          </div>
        </div>
        {loading ? <span className="inline-flex items-center rounded-full px-3 py-1 bg-indigo-500/10 text-indigo-400 text-[10px] font-black uppercase tracking-widest animate-pulse border border-indigo-500/20 shadow-sm">Syncing Fleet</span> : null}
      </div>

      <button
        type="button"
        className={`w-full bg-zinc-900 text-zinc-400 border border-dashed border-white/10 rounded-xl p-4 text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-3 mb-6 hover:bg-white/5 hover:border-white/20 hover:text-zinc-200 transition-all group shrink-0 shadow-sm ${fullPage ? "max-w-xs self-start" : ""}`}
        onClick={() => setShowModal(true)}
      >
        <span className="text-lg bg-white/5 w-6 h-6 rounded-md flex items-center justify-center group-hover:bg-white/10">+</span> 
        Deploy New Agent
      </button>

      <div className={`${listContainerClass} overflow-y-auto custom-scrollbar flex-1 pr-1`}>
        {agents.length === 0 ? (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-center bg-white/[0.02] border border-dashed border-white/5 rounded-2xl">
            <span className="text-4xl mb-4 opacity-20">🤖</span>
            <p className="text-zinc-500 text-sm font-medium">No agents active in the current fleet.</p>
            <p className="text-zinc-600 text-xs mt-1">Add an agent to start delegating work.</p>
          </div>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="flex flex-col gap-4 p-5 rounded-2xl bg-zinc-950 border border-white/5 hover:border-indigo-500/30 transition-all group shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="grid gap-2 min-w-0 flex-1">
                  <div className="font-black text-sm text-zinc-100 tracking-tight">
                    {editingId === agent.id ? (
                      <input
                        className="w-full bg-zinc-900 border border-indigo-500/50 rounded-lg px-2 py-1 text-sm text-zinc-100 outline-none shadow-inner"
                        value={editValue}
                        autoFocus
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitEdit(agent);
                          if (e.key === "Escape") cancelEdit();
                        }}
                        onBlur={() => commitEdit(agent)}
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:text-indigo-400 transition-colors flex items-center gap-2 group/name"
                        onClick={() => startEdit(agent)}
                        title="Click to rename"
                      >
                        {agent.name}
                        <span className="text-[10px] opacity-0 group-hover/name:opacity-100 text-zinc-600 transition-opacity">✎</span>
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <span className="px-2 py-0.5 rounded-md bg-zinc-900 border border-white/5 text-[9px] font-black uppercase tracking-tighter text-zinc-500">{agent.platform}</span>
                    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-tighter ${
                      agent.role === "orchestrator" ? "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" : "text-zinc-500 bg-zinc-900 border-white/5"
                    }`}>{agent.role}</span>
                    <span className={`px-2 py-0.5 rounded-md border text-[9px] font-black uppercase tracking-tighter ${
                      agent.status === "active" || agent.status === "idle" || agent.status === "done" ? "text-emerald-500 bg-emerald-500/5 border-emerald-500/10" : "text-zinc-500 bg-zinc-900 border-white/5"
                    }`}>{agent.status}</span>
                  </div>
                </div>
                {queueCounts[agent.id] ? (
                  <div className="shrink-0 bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-1 rounded-lg flex items-center gap-1.5 animate-pulse shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    <span className="text-[10px] font-black uppercase tracking-tighter">{queueCounts[agent.id]}</span>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">Model / Specialty</span>
                {(agent.platform === "local" || agent.platform === "ollama") ? (
                  <select
                    className="bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:border-indigo-500/50 focus:bg-zinc-900 outline-none w-full appearance-none cursor-pointer transition-all shadow-inner"
                    value={agent.specialty || ""}
                    onChange={(event) =>
                      onUpdateAgentSpecialty(agent.id, event.target.value.trim())
                    }
                  >
                    <option value="">Select a model...</option>
                    {(catalog[agent.platform] || []).map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value="custom">+ Use custom model...</option>
                  </select>
                ) : (
                  <input
                    className="bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:border-indigo-500/50 focus:bg-zinc-900 outline-none w-full placeholder:text-zinc-700 transition-all shadow-inner"
                    defaultValue={agent.specialty || ""}
                    placeholder="e.g. design/ui"
                    onBlur={(event) =>
                      onUpdateAgentSpecialty(agent.id, event.target.value.trim())
                    }
                  />
                )}
                
                {((agent.platform === "local" || agent.platform === "ollama") && (!catalog[agent.platform]?.includes(agent.specialty) && agent.specialty !== "")) && (
                  <input
                    className="bg-zinc-900/50 border border-white/5 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:border-indigo-500/50 focus:bg-zinc-900 outline-none w-full placeholder:text-zinc-700 transition-all shadow-inner mt-1"
                    defaultValue={agent.specialty || ""}
                    placeholder="Enter custom model name..."
                    onBlur={(event) =>
                      onUpdateAgentSpecialty(agent.id, event.target.value.trim())
                    }
                  />
                )}
              </div>

              <div className="flex gap-2 pt-2 border-t border-white/5 mt-auto">
                <button
                  type="button"
                  className="flex-1 bg-zinc-900 border border-white/10 text-zinc-500 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-zinc-800 hover:text-zinc-200 transition-all shadow-sm active:scale-95"
                  onClick={() =>
                    onUpdateAgentRole(
                      agent.id,
                      agent.role === "orchestrator" ? "worker" : "orchestrator"
                    )
                  }
                >
                  {agent.role === "orchestrator" ? "Demote to worker" : "Promote to Boss"}
                </button>
                <button
                  type="button"
                  className="bg-zinc-900 border border-white/10 text-zinc-600 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all shadow-sm active:scale-95"
                  onClick={() => onDeleteAgent(agent.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal ? (
        <div
          className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[100] p-4 animate-in fade-in duration-300"
          onClick={(event) =>
            event.target === event.currentTarget && setShowModal(false)
          }
        >
          <div className="bg-zinc-900 border border-white/10 rounded-[32px] p-8 w-full max-w-md shadow-2xl flex flex-col gap-6 animate-in zoom-in-95 duration-300">
            <div className="flex items-center justify-between">
              <div className="grid gap-1">
                <h2 className="text-2xl font-black text-zinc-100 tracking-tighter leading-none">Deploy Agent</h2>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em]">New Swarm Instance</p>
              </div>
              <button
                type="button"
                className="w-10 h-10 flex items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-red-500/20 hover:text-red-400 transition-all shadow-lg active:scale-90"
                onClick={() => setShowModal(false)}
              >
                ✕
              </button>
            </div>

            <div className="grid gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Instance Label *</label>
                <input
                  className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && handleCreate()}
                  placeholder="e.g. Agent Alpha"
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Platform</label>
                  <select 
                    className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none appearance-none cursor-pointer shadow-inner"
                    value={platform} 
                    onChange={(event) => setPlatform(event.target.value)}
                  >
                    {platforms.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Fleet Role</label>
                  <select 
                    className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none appearance-none cursor-pointer shadow-inner"
                    value={role} 
                    onChange={(event) => setRole(event.target.value)}
                  >
                    {roles.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Specialty / Model</label>
                {(platform === "local" || platform === "ollama") ? (
                  <div className="grid gap-2">
                    <select
                      className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none appearance-none cursor-pointer shadow-inner"
                      value={specialty}
                      onChange={(event) => setSpecialty(event.target.value)}
                    >
                      <option value="">Select a model...</option>
                      {(catalog[platform] || []).map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                      <option value="custom">+ Use custom model...</option>
                    </select>
                    {(!catalog[platform]?.includes(specialty) && specialty !== "") && (
                      <input
                        className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner"
                        value={specialty === "custom" ? "" : specialty}
                        onChange={(event) => setSpecialty(event.target.value)}
                        placeholder="Enter custom model name..."
                      />
                    )}
                  </div>
                ) : (
                  <input
                    className="w-full bg-zinc-950 border border-white/5 rounded-2xl px-4 py-3 text-sm text-zinc-100 focus:border-indigo-500/50 outline-none placeholder:text-zinc-700 transition-all shadow-inner"
                    value={specialty}
                    onChange={(event) => setSpecialty(event.target.value)}
                    placeholder="e.g. backend, security"
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-3 mt-4">
              <button 
                type="button" 
                className="w-full bg-indigo-600 text-white p-4 text-xs font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-xl shadow-indigo-600/20 active:scale-95"
                onClick={handleCreate} 
                disabled={!name.trim()}
              >
                Initialize Deployment
              </button>
              <button
                type="button"
                className="w-full bg-zinc-800/50 border border-white/5 text-zinc-500 p-4 text-xs font-black uppercase tracking-[0.2em] rounded-2xl hover:bg-zinc-800 hover:text-zinc-300 transition-all"
                onClick={() => setShowModal(false)}
              >
                Abort
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
