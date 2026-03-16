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

function parseChangeSummary(text) {
  const marker = "[Hydra Change Summary]";
  const idx = text.indexOf(marker);
  if (idx === -1) return null;
  const summaryText = text.slice(idx + marker.length).trim();
  const mainText = text.slice(0, idx).trim();
  const lines = summaryText.split("\n");
  const headerLine = lines[0] || "";
  const filesMatch = headerLine.match(/Files changed:\s*(\d+)/);
  const addedMatch = headerLine.match(/\+(\d+)/);
  const deletedMatch = headerLine.match(/-(\d+)/);
  const totalFiles = filesMatch ? parseInt(filesMatch[1], 10) : 0;
  const totalAdded = addedMatch ? parseInt(addedMatch[1], 10) : 0;
  const totalDeleted = deletedMatch ? parseInt(deletedMatch[1], 10) : 0;
  const files = [];
  let i = 1;
  while (i < lines.length) {
    const line = lines[i];
    const fileMatch = line.match(/^-\s+(.+?)\s+\((\w+),\s*\+(\d+)\s*\/\s*-(\d+)\)/);
    if (fileMatch) {
      const file = {
        path: fileMatch[1],
        status: fileMatch[2],
        addedLines: parseInt(fileMatch[3], 10),
        deletedLines: parseInt(fileMatch[4], 10),
        diff: ""
      };
      i++;
      if (lines[i] && lines[i].trim() === "```diff") {
        i++;
        const diffLines = [];
        while (i < lines.length && lines[i].trim() !== "```") {
          diffLines.push(lines[i]);
          i++;
        }
        file.diff = diffLines.join("\n");
        i++;
      }
      files.push(file);
    } else {
      i++;
    }
  }
  return { mainText, totalFiles, totalAdded, totalDeleted, files };
}

function FileDiffViewer({ file, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-zinc-950 border border-white/10 rounded-[5px] w-full max-w-3xl max-h-[80vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            <span className="text-[11px] font-black uppercase tracking-widest text-zinc-300">{file.path}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-emerald-400 font-bold">+{file.addedLines}</span>
            <span className="text-[10px] text-red-400 font-bold">-{file.deletedLines}</span>
            <button onClick={onClose} className="text-zinc-600 hover:text-zinc-300 transition-colors text-lg leading-none">×</button>
          </div>
        </div>
        <div className="overflow-auto p-5 custom-scrollbar">
          {file.diff ? (
            <pre className="text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-all">
              {file.diff.split("\n").map((line, idx) => {
                const isAdded = line.startsWith("+") && !line.startsWith("+++");
                const isRemoved = line.startsWith("-") && !line.startsWith("---");
                const isHeader = line.startsWith("@@");
                return (
                  <div key={idx} className={`px-2 rounded ${
                    isAdded ? "bg-emerald-500/10 text-emerald-400" :
                    isRemoved ? "bg-red-500/10 text-red-400" :
                    isHeader ? "text-indigo-400 opacity-60" :
                    "text-zinc-400"
                  }`}>{line || " "}</div>
                );
              })}
            </pre>
          ) : (
            <p className="text-zinc-600 text-xs text-center py-8">No diff recorded for this file.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ChangeSummaryBlock({ summary }) {
  const [open, setOpen] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState(null);
  return (
    <>
      {selectedFile && <FileDiffViewer file={selectedFile} onClose={() => setSelectedFile(null)} />}
      <div className="mt-3 rounded-[5px] border border-white/5 bg-zinc-950/60 overflow-hidden">
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-indigo-400">📁 Modified Files {summary.totalFiles}</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[9px] text-emerald-400 font-bold">+{summary.totalAdded}</span>
            <span className="text-[9px] text-red-400 font-bold">-{summary.totalDeleted}</span>
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">{open ? "▲" : "▼"}</span>
          </span>
        </button>
        {open && (
          <div className="border-t border-white/5 divide-y divide-white/5">
            {summary.files.map(file => (
              <button
                key={file.path}
                onClick={() => setSelectedFile(file)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left group"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  file.status === "added" ? "bg-emerald-500" :
                  file.status === "deleted" ? "bg-red-500" :
                  "bg-amber-400"
                }`} />
                <span className="text-[11px] font-mono text-zinc-300 flex-1 truncate group-hover:text-white transition-colors">{file.path}</span>
                <span className="text-[9px] text-emerald-400 font-bold shrink-0">+{file.addedLines}</span>
                <span className="text-[9px] text-red-400 font-bold shrink-0 ml-1">-{file.deletedLines}</span>
                <span className="text-[9px] text-zinc-600 ml-2 opacity-0 group-hover:opacity-100 transition-opacity">VIEW DIFF →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
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
  for (const event of taskEvents) {
    if (event.agentId !== orchestratorAgent?.id && event.kind !== "system") continue;

    // User messages are rendered from tasks/local optimistic messages.
    if (event.kind === "user") continue;
     
    // Hide events for tasks that are already rendered as finished blocks
    if (finishedTaskIds.has(event.taskId)) continue;

    if (event.kind === "tool_start" || event.kind === "tool_done" || event.kind === "tool_error") {
      items.push({
        key: `event-${event.id || event.timestamp}`,
        kind: event.kind,
        timestamp: event.timestamp || now,
        label: event.label || "Hydra",
        text: trimText(event.message),
        action: event.action || null,
        metadata: event.data ? (typeof event.data === "string" ? JSON.parse(event.data) : event.data) : null
      });
      continue;
    }
  }

  // Initial "Warm up" state for active tasks
  const activeTask = [...tasks].reverse().find(t => ["pending", "sent", "working"].includes(t.status));
  if (activeTask && activeTask.agent_id === orchestratorAgent?.id) {
    items.push({
      key: `status-init-${activeTask.id}`,
      kind: "thinking_process",
      timestamp: activeTask.created_at || now,
      label: orchestratorAgent?.name || "Orchestrator",
      text: activeTask.status === "working" ? "Thinking..." : "Establishing neural link..."
    });
  }

  return items
    .filter((item) => item.text || item.action)
    .sort((left, right) => getTimestamp(left.timestamp) - getTimestamp(right.timestamp))
    .slice(-50);
}

function ConversationItem({ item, onRetry }) {
  const isUser = item.kind === "user";
  const isThinking = item.kind === "thinking_process";
  
  if (isThinking) {
    return (
      <div className="flex flex-col gap-2 self-start max-w-[90%]">
        <div className="flex items-center gap-3 py-2.5 px-4 rounded-[5px] bg-indigo-500/5 border border-indigo-500/10 text-[11px]">
          <TriangleLoader />
          <span className="font-black text-indigo-400 uppercase tracking-[0.15em] leading-none">
            {item.text}
          </span>
          <span className="text-zinc-700 tabular-nums ml-auto font-mono">{formatClock(item.timestamp)}</span>
        </div>
      </div>
    );
  }

  if (item.kind === "tool_start" || item.kind === "tool_done" || item.kind === "tool_error") {
    const icons = { list_files: "📂", read_file: "📖", read_file_lines: "📖", read_files: "📖", search_files: "🔍", write_file: "✏️", replace: "✏️", apply_patch: "✏️", run_command: "⚡", rebuild_app: "🔨", reload_app: "🔄", restart_app: "🔄", delegate_task: "🤝", delegate_tasks: "🤝", batch_actions: "📦" };
    const icon = icons[item.action] || "🔧";
    const isDone = item.kind === "tool_done";
    const isError = item.kind === "tool_error";
    const dotColor = isError ? "bg-red-500" : isDone ? "bg-emerald-500" : "bg-amber-400 animate-pulse";
    const textColor = isError ? "text-red-400" : isDone ? "text-emerald-400" : "text-amber-400";
    const label = item.action ? item.action.replace(/_/g, " ") : "tool";
    return (
      <div className="flex items-center gap-2.5 self-start max-w-[90%] px-3 py-1.5 rounded-full bg-zinc-900/60 border border-white/5 animate-in fade-in duration-300">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-[10px] text-zinc-600">{icon}</span>
        <span className={`text-[10px] font-bold uppercase tracking-widest ${textColor}`}>{label}</span>
        {item.text && <span className="text-[10px] text-zinc-600 truncate max-w-[300px]">{item.text}</span>}
        <span className="text-zinc-700 tabular-nums ml-auto font-mono text-[9px]">{formatClock(item.timestamp)}</span>
      </div>
    );
  }

  const bubbleClass = `flex flex-col gap-2 max-w-[85%] p-6 rounded-[5px] border shadow-2xl transition-all animate-in slide-in-from-bottom-2 duration-300 ${
    isUser
      ? "self-end bg-indigo-600 text-white border-indigo-500"
      : "self-start bg-zinc-900 border-white/5 text-zinc-100"
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
        {!isUser && parseChangeSummary(item.text) ? parseChangeSummary(item.text).mainText : item.text}
      </div>
      {!isUser && parseChangeSummary(item.text) && parseChangeSummary(item.text).files.length > 0 && (
        <ChangeSummaryBlock summary={parseChangeSummary(item.text)} />
      )}
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
  const DRAFT_KEY = "hydra:chat:draft";
  const [taskText, setTaskText] = React.useState(() => {
    try { return localStorage.getItem(DRAFT_KEY) || ""; } catch { return ""; }
  });
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
    setLocalMessages(current => current.filter(lm => !tasks.some(t => trimText(t.user_task) === trimText(lm.text))));
  }, [tasks]);

  React.useEffect(() => {
    try { localStorage.setItem(DRAFT_KEY, taskText); } catch {}
  }, [taskText]);

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
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
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
    <section className="flex flex-col bg-zinc-900/50 border border-white/5 rounded-[5px] overflow-hidden h-full shadow-2xl relative">
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
        <div className={`relative flex items-end gap-3 bg-zinc-900/80 border rounded-[5px] p-2.5 transition-all duration-500 ${disabled ? "opacity-40 grayscale" : "border-white/10 shadow-2xl focus-within:border-indigo-500/50 shadow-indigo-500/5"}`}>
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
            Auto Pilot {approvalMode === "auto" ? "Active" : "Disabled"}
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
