import { useState } from "react";

function formatClock(value) {
  const d = new Date(value || 0);
  return isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function truncate(text, max = 80) {
  const s = String(text || "").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

const STATUS_LABEL = { pending: "pending", sent: "sent", working: "working", done: "done", error: "error" };
const STATUS_CLASS = { pending: "queue-badge-pending", sent: "queue-badge-sent", working: "queue-badge-working", done: "queue-badge-done", error: "queue-badge-error" };

function TaskRow({ task, agentName }) {
  return (
    <tr className="queue-row">
      <td className="queue-td queue-td-agent">{agentName}</td>
      <td className="queue-td queue-td-task">{truncate(task.user_task)}</td>
      <td className="queue-td">
        <span className={`queue-badge ${STATUS_CLASS[task.status] || "queue-badge-pending"}`}>
          {STATUS_LABEL[task.status] || task.status}
        </span>
      </td>
      <td className="queue-td queue-td-time">{formatClock(task.created_at)}</td>
      <td className="queue-td queue-td-time">{task.completed_at ? formatClock(task.completed_at) : "—"}</td>
    </tr>
  );
}

function Section({ title, tasks, agents, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  const agentMap = Object.fromEntries((agents || []).map(a => [a.id, a.name]));

  return (
    <div className="queue-section">
      <button type="button" className="queue-section-header" onClick={() => setOpen(v => !v)}>
        <span>{open ? "▾" : "▸"}</span>
        <span>{title}</span>
        <span className="queue-section-count">{tasks.length}</span>
      </button>
      {open && (
        <div className="queue-table-wrap">
          {tasks.length === 0 ? (
            <p className="queue-empty-section">None</p>
          ) : (
            <table className="queue-table">
              <thead>
                <tr>
                  <th className="queue-th">Agent</th>
                  <th className="queue-th">Task</th>
                  <th className="queue-th">Status</th>
                  <th className="queue-th">Created</th>
                  <th className="queue-th">Done</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(task => (
                  <TaskRow key={task.id} task={task} agentName={agentMap[task.agent_id] || task.agent_name || "?"} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

export function TaskQueueViewer({ tasks = [], agents = [] }) {
  if (tasks.length === 0) {
    return (
      <div className="queue-panel">
        <div className="queue-empty">
          <p>No tasks yet. Send a message to the orchestrator to get started.</p>
        </div>
      </div>
    );
  }

  const active = tasks.filter(t => ["pending", "sent", "working"].includes(t.status));
  const done = tasks.filter(t => t.status === "done").slice(-20).reverse();
  const errors = tasks.filter(t => t.status === "error");

  return (
    <div className="queue-panel">
      <Section title="🔴 Active" tasks={active} agents={agents} defaultOpen={true} />
      <Section title="❌ Errors" tasks={errors} agents={agents} defaultOpen={true} />
      <Section title="✅ Completed" tasks={done} agents={agents} defaultOpen={false} />
    </div>
  );
}
