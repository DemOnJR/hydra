import { useState } from "react";

const platforms = [
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" }
];

const roles = [
  { value: "orchestrator", label: "Orchestrator" },
  { value: "worker", label: "Worker" }
];

export function AgentSidebar({
  agents,
  loading,
  queueCounts,
  onCreateAgent,
  onDeleteAgent,
  onUpdateAgentRole,
  onUpdateAgentSpecialty,
  onRenameAgent
}) {
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState(platforms[0].value);
  const [role, setRole] = useState(roles[1].value);
  const [specialty, setSpecialty] = useState("");

  // Inline name editing state
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");

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

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Agents</h2>
        {loading ? <span className="pill">Syncing</span> : null}
      </div>

      <button
        type="button"
        className="agent-new-btn"
        onClick={() => setShowModal(true)}
      >
        <span>+</span> Add agent
      </button>

      <div className="list">
        {agents.length === 0 ? (
          <p className="empty-state">No agents configured.</p>
        ) : (
          agents.map((agent) => (
            <div key={agent.id} className="agent-row">
              <div className="agent-main">
                <div className="agent-name">
                  {editingId === agent.id ? (
                    <input
                      className="agent-name-input"
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
                      className="agent-name-editable"
                      onClick={() => startEdit(agent)}
                      title="Click to rename"
                    >
                      {agent.name}
                    </span>
                  )}
                </div>
                <div className="agent-meta">
                  <span>{agent.platform}</span>
                  <span>{agent.role}</span>
                  <span>{agent.status}</span>
                  {queueCounts[agent.id] ? <span>{queueCounts[agent.id]} queued</span> : null}
                </div>
                <input
                  className="agent-specialty-input"
                  defaultValue={agent.specialty || ""}
                  placeholder="specialty, e.g. design/ui"
                  onBlur={(event) =>
                    onUpdateAgentSpecialty(agent.id, event.target.value.trim())
                  }
                />
              </div>
              <div className="agent-actions">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() =>
                    onUpdateAgentRole(
                      agent.id,
                      agent.role === "orchestrator" ? "worker" : "orchestrator"
                    )
                  }
                >
                  {agent.role === "orchestrator" ? "Set worker" : "Set orchestrator"}
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => onDeleteAgent(agent.id)}
                >
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal ? (
        <div
          className="modal-overlay"
          onClick={(event) =>
            event.target === event.currentTarget && setShowModal(false)
          }
        >
          <div className="modal">
            <div className="modal-header">
              <h2>Add Agent</h2>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowModal(false)}
              >
                x
              </button>
            </div>

            <div className="modal-field">
              <label className="modal-label">Agent label *</label>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleCreate()}
                placeholder="e.g. Agent Gemini"
                autoFocus
              />
            </div>

            <div className="modal-field">
              <label className="modal-label">Platform</label>
              <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                {platforms.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-field">
              <label className="modal-label">Role</label>
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                {roles.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="modal-field">
              <label className="modal-label">Specialty</label>
              <input
                value={specialty}
                onChange={(event) => setSpecialty(event.target.value)}
                placeholder="e.g. design, ui/ux, frontend"
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button type="button" onClick={handleCreate} disabled={!name.trim()}>
                Add agent
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
