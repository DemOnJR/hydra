import { useEffect, useRef, useState } from "react";

export function useTaskManager({ activeProjectId, agents, markAgentStatus }) {
  const [responses, setResponses] = useState([]);
  const [taskQueues, setTaskQueues] = useState({});
  const [taskEvents, setTaskEvents] = useState([]);
  const activeTasksRef = useRef({});
  const taskQueuesRef = useRef({});

  useEffect(() => {
    if (!window.agentSync?.onTaskEvent) {
      return undefined;
    }

    return window.agentSync.onTaskEvent((event) => {
      setTaskEvents((current) => {
        if (!event?.id) {
          return current;
        }

        if (current.some((entry) => entry.id === event.id)) {
          return current;
        }

        return [...current, event].slice(-200);
      });
    });
  }, []);

  function updateQueues(nextQueues) {
    taskQueuesRef.current = nextQueues;
    setTaskQueues(nextQueues);
  }

  async function finalizeTask(agentId, taskId, responseText) {
    const agent = agents.find((item) => item.id === agentId);

    setResponses((current) => [
      {
        id: `${agentId}-${Date.now()}`,
        taskId,
        agentId,
        agentName: agent?.name || "Unknown agent",
        response: responseText,
        timestamp: new Date().toISOString()
      },
      ...current
    ]);

    const nextActiveTasks = { ...activeTasksRef.current };
    delete nextActiveTasks[agentId];
    activeTasksRef.current = nextActiveTasks;

    await markAgentStatus(agentId, "done");

    const queue = taskQueuesRef.current[agentId] || [];

    if (queue.length === 0) {
      return;
    }

    const [nextTask, ...remaining] = queue;
    updateQueues({
      ...taskQueuesRef.current,
      [agentId]: remaining
    });

    const nextAgent = agents.find((item) => item.id === agentId);
    if (nextAgent) {
      await dispatchTask(nextAgent, nextTask);
    }
  }

  async function sendTask(agentId, taskText) {
    const agent = agents.find((item) => item.id === agentId);

    if (!agent) {
      throw new Error("Agent not found.");
    }

    if (!activeProjectId) {
      throw new Error("Select a project before sending tasks.");
    }

    if (!taskText.trim()) {
      return null;
    }

    if (activeTasksRef.current[agentId]) {
      const nextQueues = {
        ...taskQueuesRef.current,
        [agentId]: [...(taskQueuesRef.current[agentId] || []), taskText]
      };

      updateQueues(nextQueues);
      return null;
    }

    return dispatchTask(agent, taskText);
  }

  async function dispatchTask(agent, taskText) {
    const marker = `${agent.id}:${Date.now()}`;

    activeTasksRef.current = {
      ...activeTasksRef.current,
      [agent.id]: marker
    };

    await markAgentStatus(agent.id, "working");

    try {
      const result = await window.agentSync.sendTaskToAgent(agent, activeProjectId, taskText);

      await finalizeTask(agent.id, result.taskId, result.response);
      return result;
    } catch (error) {
      const nextActiveTasks = { ...activeTasksRef.current };
      delete nextActiveTasks[agent.id];
      activeTasksRef.current = nextActiveTasks;
      await markAgentStatus(agent.id, "error");
      throw error;
    }
  }

  async function broadcast(taskText, selectedAgentIds) {
    const targets = selectedAgentIds.length
      ? agents.filter((agent) => selectedAgentIds.includes(agent.id))
      : agents;

    await Promise.all(targets.map((agent) => sendTask(agent.id, taskText)));
  }

  return {
    responses,
    taskQueues,
    taskEvents: taskEvents.filter(
      (event) => !activeProjectId || event.projectId === activeProjectId
    ),
    sendTask,
    broadcast
  };
}
