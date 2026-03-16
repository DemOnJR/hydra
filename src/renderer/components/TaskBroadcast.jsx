import * as React from "react";
import { request } from "../api.js";
import {
  buildInteractiveReplyMessage,
  extractInteractiveReplyState
} from "../interactiveReply.js";

function getTimestamp(value) {
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatClock(value) {
  const parsed = new Date(value || Date.now());
  return Number.isNaN(parsed.getTime())
    ? ""
    : parsed.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });
}

function trimText(value) {
  return String(value ?? "").trim();
}

function TriangleLoader() {
  return (
    <div className="relative w-5 h-5 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 40 40" className="w-full h-full triangle-loader">
        <path
          d="M20 5 L35 32 L5 32 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-indigo-500 triangle-path"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-1 h-1 bg-indigo-400 rounded-full animate-ping" />
      </div>
    </div>
  );
}

function buildConversationItems({ tasks, taskEvents, orchestratorAgent, localMessages }) {
  const items = [];
  const now = new Date().toISOString();
  const finishedTaskIds = new Set(
    tasks
      .filter(t => t.status === "complete" || t.status === "error")
      .map(t => t.id)
  );

  // 1. Add User Messages (Existing + Local)
  const taskUserTexts = new Set(
    tasks
      .filter(t => t.agent_id === orchestratorAgent?.id)
      .map(t => trimText(t.user_task))
  );

  for (const task of tasks) {
    if (task.agent_id === orchestratorAgent?.id) {
      items.push({
        key: `user-${task.id}`,
        kind: "user",
        timestamp: task.created_at || now,
        label: "You",
        text: trimText(task.user_task)
      });

      if (trimText(task.response)) {
        items.push({
          key: `assistant-${task.id}`,
          kind: task.status === "error" ? "error" : "assistant",
          timestamp: task.completed_at || task.updated_at || task.created_at || now,
          label: orchestratorAgent?.name || "Orchestrator",
          text: trimText(task.response)
        });
      }
    }
  }

  for (const msg of localMessages) {
    const trimmed = trimText(msg.text);
    if (!taskUserTexts.has(trimmed)) {
      items.push({
        key: `local-${msg.timestamp}`,
        kind: "user",
        timestamp: msg.timestamp,
        label: "You",
        text: trimmed
      });
    }
  }

  // 2. Handle Events (Only show if task NOT finished)
  const taskLatestWorkingEvent = {};
  for (const event of taskEvents) {
    if (event.agentId !== orchestratorAgent?.id && event.kind !== "system") continue;

    // User messages are rendered from tasks/local optimistic messages.
    // Rendering them from task events as well causes duplicates while the task is running.
    if (event.kind === "user") continue;
     
    // Hide events for tasks that are already rendered as finished blocks
    if (finishedTaskIds.has(event.taskId)) continue;

    if ((event.kind === "working" || event.kind === "progress") && event.taskId) {
      taskLatestWorkingEvent[event.taskId] = event;
      continue;
    }

    items.push({
      key: event.id,
      kind: event.kind,
      timestamp: event.timestamp || now,
      label: event.label || "Hydra",
      text: trimText(event.message),
      metadata: event.data ? (typeof event.data === "string" ? JSON.parse(event.data) : event.data) : null
    });
  }

  // Add the latest working state (Only for active tasks)
  for (const event of Object.values(taskLatestWorkingEvent)) {
    items.push({
      key: `working-${event.taskId}`,
      kind: "thinking_process",
      timestamp: event.timestamp || now,
      label: event.label || "Hydra",
      text: event.message || "Synthesizing intelligence..."
    });
  }

  // 3. Initial "Warm up" state
  const activeTask = [...tasks].reverse().find(t => ["pending", "sent"].includes(t.status));
  if (activeTask && !taskLatestWorkingEvent[activeTask.id]) {
    items.push({
      key: `status-init-${activeTask.id}`,
      kind: "thinking_process",
      timestamp: activeTask.created_at || now,
      label: orchestratorAgent?.name || "Orchestrator",
      text: "Establishing neural link..."
    });
  }

  return items
    .filter((item) => item.text)
    .sort((left, right) => getTimestamp(left.timestamp) - getTimestamp(right.timestamp))
    .slice(-50);
}

function ConversationItem({ item, onRetry }) {
  const [showDetail, setShowDetail] = React.useState(false);

  if (item.kind === "thinking_process") {
    return (
      <div className="flex flex-col gap-2 self-start max-w-[90%]">
        <div 
          className="flex items-center gap-3 py-2.5 px-4 rounded-2xl bg-indigo-500/5 border border-indigo-500/10 text-[11px] cursor-pointer hover:bg-indigo-500/10 transition-all group"
          onClick={() => setShowDetail(!showDetail)}
        >
          <TriangleLoader />
          <div className="flex flex-col">
            <span className="font-black text-indigo-400 uppercase tracking-[0.15em] leading-none">
              Thinking Process
            </span>
            <span className="text-[9px] text-zinc-600 mt-1 uppercase font-bold group-hover:text-zinc-400 transition-colors">
              {showDetail ? "Click to collapse" : "Click to view stream"}
            </span>
          </div>
          <span className="text-zinc-700 tabular-nums ml-auto font-mono">{formatClock(item.timestamp)}</span>
        </div>
        
        {showDetail && (
          <div className="ml-4 pl-4 border-l-2 border-indigo-500/20 py-2 animate-in fade-in slide-in-from-left-2 duration-300">
            <div className="text-xs text-zinc-400 font-medium leading-relaxed bg-zinc-900/50 p-3 rounded-xl border border-white/5 whitespace-pre-wrap">
              {item.text}
              <span className="inline-block w-1.5 h-3 bg-indigo-500 ml-1 animate-pulse" />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "system" || item.kind === "info") {
    const isCommand = item.metadata?.kind === "command";
    const isEdit = item.metadata?.kind === "file_edit";

    return (
      <div className="flex flex-col gap-2 self-center w-full max-w-2xl">
        <div 
          className="flex items-center gap-3 py-2 px-4 rounded-xl bg-zinc-900 border border-white/5 text-[10px] text-zinc-500 hover:border-indigo-500/30 transition-all cursor-pointer shadow-sm group"
          onClick={() => setShowDetail(!showDetail)}
        >
          <div className={`w-1.5 h-1.5 rounded-full ${isCommand ? "bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]" : "bg-indigo-500"}`} />
          <span className="font-black uppercase tracking-widest text-zinc-400 flex-1">
            {isCommand ? "Hydra Terminal" : isEdit ? "Neural Edit" : "System Core"}
          </span>
          <span className="text-zinc-600 font-black tracking-tighter opacity-0 group-hover:opacity-100 transition-opacity">
            {showDetail ? "COLLAPSE" : "EXPAND"}
          </span>
        </div>

        {showDetail && isCommand && (
          <div className="bg-black rounded-2xl border border-emerald-500/20 p-5 font-mono text-xs leading-relaxed terminal-glow animate-in slide-in-from-top-2">
            <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/20 border border-amber-500/40" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500/20 border border-emerald-500/40" />
              </div>
              <span className="ml-3 text-zinc-600 text-[9px] uppercase font-black tracking-widest">Execution Buffer</span>
            </div>
            <div className="text-emerald-500/90 mb-2 flex items-center gap-2">
              <span className="opacity-50">#</span> {item.metadata.command || "exec"}
            </div>
            <pre className="text-zinc-400 whitespace-pre-wrap break-all custom-scrollbar max-h-80 overflow-y-auto pr-2">
              <code>
                {item.metadata.stdout || item.metadata.stderr || "No output returned."}
              </code>
            </pre>
          </div>
        )}

        {showDetail && isEdit && (
          <div className="bg-zinc-950 rounded-2xl border border-white/5 p-5 animate-in slide-in-from-top-2 shadow-inner">
             <pre className="text-[11px] font-mono leading-relaxed overflow-x-auto custom-scrollbar text-zinc-400">
              <code>{item.metadata.diff || "No structural changes recorded."}</code>
            </pre>
          </div>
        )}
      </div>
    );
  }

  const isUser = item.kind === "user";
  const bubbleClass = `flex flex-col gap-2 max-w-[85%] p-6 rounded-[32px] border shadow-2xl transition-all animate-in slide-in-from-bottom-2 duration-300 ${
    isUser
      ? "self-end bg-indigo-600 text-white border-indigo-500 rounded-tr-none"
      : "self-start bg-zinc-900 border-white/5 text-zinc-100 rounded-tl-none"
  }`;

  return (
    <article className={bubbleClass}>
      <header className={`flex items-center justify-between gap-4 mb-2 pb-2 border-b ${isUser ? "border-white/10" : "border-white/5"}`}>
        <div className="flex items-center gap-2">
          <div className={`w-1 h-1 rounded-full ${isUser ? "bg-white" : "bg-indigo-500"}`} />
          <strong className={`text-[9px] font-black uppercase tracking-[0.25em] ${isUser ? "text-indigo-100" : "text-zinc-500"}`}>{item.label}</strong>
        </div>
        <span className={`text-[9px] font-bold tabular-nums ${isUser ? "text-indigo-200" : "text-zinc-600"}`}>{formatClock(item.timestamp)}</span>
      </header>
      <div className="text-[15px] leading-relaxed whitespace-pre-wrap break-words font-medium tracking-tight">
        {item.text}
      </div>
    </article>
  );
}

export function TaskBroadcast({
  serverUrl,
  activeProject,
  orchestratorAgent,
  workerAgents,
  tasks,
  taskEvents,
  onSendToAgent
}) {
  const [taskText, setTaskText] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState("");
  const [localMessages, setLocalMessages] = React.useState([]);
  const [approvalMode, setApprovalMode] = React.useState("manual");
  const [settingsBusy, setSettingsBusy] = React.useState(false);
  const [showInfo, setShowInfo] = React.useState(false);
  const threadRef = React.useRef(null);

  React.useEffect(() => {
    let cancelled = false;
    async function loadSettings() {
      if (!serverUrl) return;
      try {
        const settings = await request(serverUrl, "/api/settings");
        if (!cancelled) setApprovalMode(settings.approval_mode || "manual");
      } catch {
        if (!cancelled) setApprovalMode("manual");
      }
    }
    loadSettings();
    return () => { cancelled = true; };
  }, [serverUrl]);

  React.useEffect(() => {
    setLocalMessages(current => current.filter(lm => !tasks.some(t => t.user_task === lm.text)));
  }, [tasks]);

  const conversationItems = buildConversationItems({ tasks, taskEvents, orchestratorAgent, localMessages });
  
  React.useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [conversationItems.length]);

  function handleSubmit(event) {
    event.preventDefault();
    if (!taskText.trim() || !orchestratorAgent) return;

    const nextTask = taskText.trim();
    setLocalMessages(prev => [...prev, { text: nextTask, timestamp: new Date().toISOString() }]);
    setTaskText("");
    setSending(true);
    setError("");

    onSendToAgent(orchestratorAgent.id, nextTask)
      .catch((err) => setError(err.message))
      .finally(() => setSending(false));
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  async function handleApprovalModeChange(nextMode) {
    if (!serverUrl || nextMode === approvalMode) return;
    setSettingsBusy(true);
    try {
      const settings = await request(serverUrl, "/api/settings", { method: "PUT", body: JSON.stringify({ approval_mode: nextMode }) });
      setApprovalMode(settings.approval_mode || nextMode);
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  const disabled = !activeProject?.id || !activeProject?.root_path?.trim() || !orchestratorAgent;
  const isWorking = tasks.some(t => t.agent_id === orchestratorAgent?.id && ["pending", "sent", "working"].includes(t.status));

  return (
    <section className="flex flex-col bg-zinc-900/50 border border-white/5 rounded-[40px] overflow-hidden h-full shadow-2xl relative">
      <div className="flex items-center justify-between p-5 border-b border-white/5 bg-zinc-900/80 backdrop-blur-md shrink-0 z-20">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className={`w-2.5 h-2.5 rounded-full transition-all duration-700 ${isWorking ? "bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.8)] animate-pulse" : "bg-zinc-700"}`} />
            {isWorking && <div className="absolute inset-0 rounded-full bg-indigo-500 animate-ping opacity-20" />}
          </div>
          <div className="grid gap-0.5">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] leading-none">Command Intelligence</p>
            <p className="text-sm font-black text-zinc-100 tracking-tight">{orchestratorAgent?.name || "System Offline"}</p>
          </div>
        </div>
        <button
          onClick={() => setShowInfo(!showInfo)}
          className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-xl border transition-all ${showInfo ? "bg-indigo-500 text-white border-indigo-400 shadow-lg shadow-indigo-500/20" : "bg-zinc-800 border-white/5 text-zinc-500 hover:text-zinc-300"}`}
        >
          {showInfo ? "Close Data" : "Project Context"}
        </button>
      </div>

      <div ref={threadRef} className="flex-1 overflow-y-auto p-8 flex flex-col gap-10 scroll-smooth custom-scrollbar bg-gradient-to-b from-zinc-950/20 to-transparent">
        {conversationItems.length === 0 ? (
          <div className="m-auto text-center p-12 bg-white/[0.02] border border-dashed border-white/5 rounded-[40px] animate-pulse">
            <div className="text-4xl mb-4 opacity-20">⚡</div>
            <p className="text-xs font-black uppercase tracking-[0.4em] text-zinc-600">Awaiting Signal</p>
          </div>
        ) : (
          conversationItems.map((item) => (
            <ConversationItem key={item.key} item={item} onRetry={(text) => onSendToAgent(orchestratorAgent.id, text)} />
          ))
        )}
      </div>

      <form className="p-6 bg-zinc-950/80 border-t border-white/5 z-20 backdrop-blur-2xl" onSubmit={handleSubmit}>
        <div className={`relative flex items-end gap-3 bg-zinc-900/80 border rounded-[32px] p-2.5 transition-all duration-500 ${disabled ? "opacity-40 grayscale" : "border-white/10 shadow-2xl focus-within:border-indigo-500/50 shadow-indigo-500/5"}`}>
          <textarea
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? "Configure Neural Root..." : "Relay command to Hydra..."}
            disabled={disabled}
            className="w-full max-h-64 min-h-[52px] bg-transparent text-zinc-100 placeholder-zinc-700 resize-none outline-none py-4 px-6 leading-relaxed text-[15px] font-medium"
            rows="1"
            style={{ height: "56px" }}
          />
          <button
            type="submit"
            disabled={disabled || sending || !taskText.trim()}
            className="flex-shrink-0 w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-800 text-white flex items-center justify-center transition-all shadow-xl shadow-indigo-600/30 active:scale-90 mb-0.5 mr-0.5"
          >
            {sending ? <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" /> : <span className="text-xl">↑</span>}
          </button>
        </div>

        <div className="flex items-center justify-between mt-5 px-3">
          <button
            type="button"
            onClick={() => handleApprovalModeChange(approvalMode === "auto" ? "manual" : "auto")}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border transition-all ${approvalMode === "auto" ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/30 shadow-indigo-500/10" : "bg-zinc-800/50 text-zinc-600 border-zinc-800 hover:text-zinc-400"}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${approvalMode === "auto" ? "bg-indigo-400 animate-pulse" : "bg-zinc-700"}`} />
            Auto-Link {approvalMode === "auto" ? "Active" : "Disabled"}
          </button>
          <div className="flex items-center gap-3">
             <span className="w-1 h-1 rounded-full bg-zinc-800" />
             <p className="text-[10px] text-zinc-700 font-black uppercase tracking-tighter italic">High-Fidelity Neural Orchestration</p>
          </div>
        </div>
      </form>
    </section>
  );
}
