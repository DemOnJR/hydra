import { useEffect, useRef, useState } from "react";
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

function isDelegatedTask(task) {
  return /delegated subtask from orchestrator/i.test(task?.user_task || "");
}

function trimText(value) {
  return String(value ?? "").trim();
}

function buildConversationItems({ tasks, taskEvents, orchestratorAgent }) {
  const orchestratorTasks = tasks
    .filter((task) => task.agent_id === orchestratorAgent?.id)
    .sort((left, right) => getTimestamp(left.created_at) - getTimestamp(right.created_at));

  const items = [];
  const existingTaskIds = new Set(orchestratorTasks.map((task) => task.id));
  const now = new Date().toISOString();

  for (const task of orchestratorTasks) {
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

  for (const event of taskEvents) {
    if (event.agentId !== orchestratorAgent?.id && event.kind !== "system") {
      continue;
    }

    if ((event.kind === "user" || event.kind === "assistant") && existingTaskIds.has(event.taskId)) {
      continue;
    }

    items.push({
      key: event.id,
      kind: event.kind,
      timestamp: event.timestamp || now,
      label: event.label || "Hydra",
      text: trimText(event.message)
    });
  }

  const activeOrchestratorTask = [...orchestratorTasks]
    .reverse()
    .find((task) => ["pending", "sent", "working"].includes(task.status));

  if (activeOrchestratorTask) {
    if (activeOrchestratorTask.status === "pending" || activeOrchestratorTask.status === "sent") {
      items.push({
        key: `status-send-${activeOrchestratorTask.id}`,
        kind: "system",
        timestamp: activeOrchestratorTask.created_at || now,
        label: "Hydra",
        text: `Sending the request to ${orchestratorAgent?.name || "the orchestrator"}...`
      });
    }

    if (activeOrchestratorTask.status === "working") {
      items.push({
        key: `status-plan-${activeOrchestratorTask.id}`,
        kind: "system",
        timestamp: activeOrchestratorTask.updated_at || activeOrchestratorTask.created_at || now,
        label: orchestratorAgent?.name || "Orchestrator",
        text: "Planning the task and deciding whether to delegate work."
      });

      const activeWorkerTasks = tasks
        .filter(
          (task) =>
            task.agent_id !== orchestratorAgent?.id &&
            isDelegatedTask(task) &&
            getTimestamp(task.created_at) >= getTimestamp(activeOrchestratorTask.created_at) &&
            ["pending", "sent", "working"].includes(task.status)
        )
        .sort((left, right) => getTimestamp(left.created_at) - getTimestamp(right.created_at));

      for (const workerTask of activeWorkerTasks) {
        items.push({
          key: `worker-active-${workerTask.id}`,
          kind: "system",
          timestamp: workerTask.updated_at || workerTask.created_at || now,
          label: "Hydra",
          text:
            workerTask.status === "working"
              ? `Waiting for ${workerTask.agent_name} to finish the delegated task.`
              : `Sending work to ${workerTask.agent_name}.`
        });
      }
    }
  }

  return items
    .filter((item) => item.text)
    .sort((left, right) => getTimestamp(left.timestamp) - getTimestamp(right.timestamp))
    .slice(-40);
}

function ConversationItem({ item }) {
  if (item.kind === "system") {
    return (
      <div className="chat-activity">
        <span className="chat-activity-dot" />
        <span className="chat-activity-label">{item.label}</span>
        <span className="chat-activity-text">{item.text}</span>
        <span className="chat-meta">{formatClock(item.timestamp)}</span>
      </div>
    );
  }

  const bubbleClass =
    item.kind === "user"
      ? "chat-bubble user"
      : item.kind === "error"
        ? "chat-bubble error"
        : "chat-bubble assistant";

  return (
    <article className={bubbleClass}>
      <header className="chat-bubble-header">
        <strong>{item.label}</strong>
        <span className="chat-meta">{formatClock(item.timestamp)}</span>
      </header>
      <p>{item.text}</p>
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
  const [taskText, setTaskText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [approvalMode, setApprovalMode] = useState("manual");
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [selectedReplyOptions, setSelectedReplyOptions] = useState({});
  const threadRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      if (!serverUrl) {
        return;
      }

      try {
        const settings = await request(serverUrl, "/api/settings");
        if (!cancelled) {
          setApprovalMode(settings.approval_mode || "manual");
        }
      } catch {
        if (!cancelled) {
          setApprovalMode("manual");
        }
      }
    }

    loadSettings();
    return () => {
      cancelled = true;
    };
  }, [serverUrl]);

  const conversationItems = buildConversationItems({ tasks, taskEvents, orchestratorAgent });
  const latestAssistantItem = [...conversationItems]
    .reverse()
    .find((item) => item.kind === "assistant" || item.kind === "error") || null;
  const interactiveReplyState = latestAssistantItem
    ? extractInteractiveReplyState(latestAssistantItem.text)
    : { awaitingInput: false, questionAnswerPairs: [], replyPrompts: [], summary: "" };
  const interactiveSignature = JSON.stringify({
    text: latestAssistantItem?.text || "",
    prompts: interactiveReplyState.replyPrompts,
    pairs: interactiveReplyState.questionAnswerPairs
  });

  useEffect(() => {
    if (!threadRef.current) {
      return;
    }

    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [conversationItems.length]);

  useEffect(() => {
    setSelectedReplyOptions({});
  }, [interactiveSignature]);

  function queueTask(sendOperation) {
    setSending(true);
    setError("");

    Promise.resolve()
      .then(sendOperation)
      .catch((submitError) => {
        setError(submitError.message);
      })
      .finally(() => {
        window.setTimeout(() => setSending(false), 250);
      });
  }

  function handleSubmit(event) {
    event.preventDefault();

    if (!taskText.trim() || !orchestratorAgent) {
      return;
    }

    const nextTask = taskText.trim();
    setTaskText("");
    queueTask(() => onSendToAgent(orchestratorAgent.id, nextTask));
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSubmit(event);
    }
  }

  function toggleReplyOption(promptIndex, optionLabel, mode) {
    setSelectedReplyOptions((current) => {
      const existing = current[promptIndex] || [];

      if (mode === "multi") {
        const nextValues = existing.includes(optionLabel)
          ? existing.filter((value) => value !== optionLabel)
          : [...existing, optionLabel];

        return {
          ...current,
          [promptIndex]: nextValues
        };
      }

      return {
        ...current,
        [promptIndex]: existing[0] === optionLabel ? [] : [optionLabel]
      };
    });
  }

  function buildSelectedPromptAnswers() {
    return interactiveReplyState.replyPrompts
      .map((prompt, index) => {
        const selected = selectedReplyOptions[index] || [];

        if (selected.length === 0) {
          return null;
        }

        return {
          question: prompt.question,
          answer: prompt.mode === "multi" ? selected.join(", ") : selected[0]
        };
      })
      .filter(Boolean);
  }

  function handleSendInteractiveReply() {
    if (!orchestratorAgent) {
      return;
    }

    const pairs =
      interactiveReplyState.questionAnswerPairs.length > 0
        ? interactiveReplyState.questionAnswerPairs
        : buildSelectedPromptAnswers();

    if (pairs.length === 0) {
      return;
    }

    const replyMessage = buildInteractiveReplyMessage(pairs, taskText);
    setTaskText("");
    queueTask(() => onSendToAgent(orchestratorAgent.id, replyMessage));
  }

  function handlePrimeContext() {
    if (!orchestratorAgent) {
      return;
    }

    queueTask(() =>
      onSendToAgent(
        orchestratorAgent.id,
        [
          "Acknowledge the full project context you received.",
          "From now on act as the orchestrator for this project.",
          `The available worker agents are: ${
            workerAgents.length
              ? workerAgents.map((agent) => `${agent.name} (${agent.platform})`).join(", ")
              : "none yet"
          }.`,
          "Summarize what the project is, where it lives on disk, and how you want the user to work with you next."
        ].join("\n")
      )
    );
  }

  async function handleApprovalModeChange(nextMode) {
    if (!serverUrl || nextMode === approvalMode) {
      return;
    }

    setSettingsBusy(true);
    try {
      const settings = await request(serverUrl, "/api/settings", {
        method: "PUT",
        body: JSON.stringify({ approval_mode: nextMode })
      });
      setApprovalMode(settings.approval_mode || nextMode);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSettingsBusy(false);
    }
  }

  const disabled = !activeProject?.id || !activeProject?.root_path?.trim() || !orchestratorAgent;
  const isWorking = tasks.some(
    (task) => task.agent_id === orchestratorAgent?.id && ["pending", "sent", "working"].includes(task.status)
  );
  const awaitingReply = interactiveReplyState.awaitingInput && !isWorking;
  const selectedPromptAnswers = buildSelectedPromptAnswers();
  const canSendInteractiveReply =
    interactiveReplyState.questionAnswerPairs.length > 0 || selectedPromptAnswers.length > 0;

  return (
    <section className="chat-panel">
      <div className="chat-panel-topbar">
        <div className="chat-panel-identity">
          <span className={`chat-status-dot ${isWorking ? "active" : "idle"}`} />
          <div className="chat-panel-title-block">
            <p className="eyebrow">Orchestrator</p>
            <p className="chat-panel-title">
              {orchestratorAgent ? orchestratorAgent.name : "No orchestrator assigned"}
            </p>
          </div>
        </div>

        <div className="chat-panel-topbar-actions">
          {isWorking ? <span className="pill working">Working...</span> : null}
          <button
            type="button"
            className="ghost-button chat-topbar-btn"
            onClick={() => setShowInfo((value) => !value)}
            title="Project info and settings"
          >
            {showInfo ? "Hide" : "Info"}
          </button>
        </div>
      </div>

      {showInfo ? (
        <div className="chat-info-drawer">
          <div className="chat-info-row">
            <span className="helper-text">
              Project: <strong>{activeProject?.name || "-"}</strong>
            </span>
            <span className="helper-text">
              Root: <strong>{activeProject?.root_path || "not set"}</strong>
            </span>
            <span className="helper-text">
              Workers: <strong>{workerAgents.length ? workerAgents.map((agent) => agent.name).join(", ") : "none"}</strong>
            </span>
          </div>
          <div className="chip-row">
            <button
              type="button"
              className={approvalMode === "manual" ? "chip active" : "chip"}
              onClick={() => handleApprovalModeChange("manual")}
              disabled={settingsBusy}
            >
              Manual approve
            </button>
            <button
              type="button"
              className={approvalMode === "auto" ? "chip active" : "chip"}
              onClick={() => handleApprovalModeChange("auto")}
              disabled={settingsBusy}
            >
              Auto execute
            </button>
            <button
              type="button"
              className="ghost-button"
              style={{ fontSize: "0.78rem", padding: "0.3rem 0.65rem" }}
              onClick={handlePrimeContext}
              disabled={disabled || sending}
            >
              Prime context
            </button>
          </div>
        </div>
      ) : null}

      <div ref={threadRef} className="chat-thread chat-thread-grow">
        {conversationItems.length === 0 ? (
          <div className="chat-empty">
            {disabled
              ? "Create a project, set the root folder, then assign one agent as orchestrator."
              : "Send a message to start the conversation. Live progress will appear here as the orchestrator works."}
          </div>
        ) : (
          conversationItems.map((item) => <ConversationItem key={item.key} item={item} />)
        )}
      </div>

      {awaitingReply ? (
        <div className="chat-reply-helper">
          <div className="chat-reply-helper-header">
            <span className="pill working">Awaiting your reply</span>
            <span className="helper-text">
              {interactiveReplyState.summary || "The orchestrator needs one more choice from you."}
            </span>
          </div>

          {interactiveReplyState.questionAnswerPairs.length > 0 ? (
            <div className="chat-reply-review">
              {interactiveReplyState.questionAnswerPairs.map((pair) => (
                <div key={`${pair.question}:${pair.answer}`} className="chat-reply-pair">
                  <strong>{pair.question}</strong>
                  <span>{pair.answer}</span>
                </div>
              ))}
            </div>
          ) : (
            interactiveReplyState.replyPrompts.map((prompt, index) => (
              <div key={`${prompt.question}:${index}`} className="chat-choice-group">
                <div className="chat-choice-question-row">
                  <p className="chat-choice-question">{prompt.question}</p>
                  {prompt.mode === "multi" ? (
                    <span className="chat-choice-mode-pill">Choose one or more</span>
                  ) : null}
                </div>
                <div className="chat-choice-options">
                  {prompt.options.map((option) => {
                    const selected = (selectedReplyOptions[index] || []).includes(option);

                    return (
                      <button
                        key={`${prompt.question}:${option}`}
                        type="button"
                        className={selected ? "chat-choice-chip active" : "chat-choice-chip"}
                        onClick={() => toggleReplyOption(index, option, prompt.mode)}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          <div className="chat-reply-helper-actions">
            <button
              type="button"
              className="chat-choice-send-btn"
              onClick={handleSendInteractiveReply}
              disabled={disabled || sending || !canSendInteractiveReply}
            >
              {interactiveReplyState.questionAnswerPairs.length > 0
                ? "Continue with these choices"
                : "Send selection"}
            </button>
            <span className="helper-text">You can add an extra note in the chat box below.</span>
          </div>
        </div>
      ) : null}

      <form className="chat-input-bar" onSubmit={handleSubmit}>
        <div className="chat-input-row">
          <textarea
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              disabled
                ? "Set up your project and orchestrator first..."
                : awaitingReply
                  ? "Reply to the orchestrator here, or use the quick choices above..."
                  : "Message the orchestrator... (Enter to send, Shift+Enter for new line)"
            }
            rows={2}
            disabled={disabled}
            className="chat-input-textarea"
          />
          <button
            type="submit"
            className="chat-send-btn"
            disabled={disabled || sending || !taskText.trim()}
            title="Send"
          >
            {sending ? "..." : "Send"}
          </button>
        </div>
      </form>

      {error ? <p className="error-text" style={{ padding: "0 0.75rem 0.5rem" }}>{error}</p> : null}
    </section>
  );
}
