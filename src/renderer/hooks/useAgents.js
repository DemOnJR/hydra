import { useEffect, useState } from "react";
import { request } from "../api.js";

export function useAgents(serverUrl) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function refreshAgents(options = {}) {
    if (!serverUrl) {
      return;
    }

    if (!options.silent) {
      setLoading(true);
    }

    try {
      const items = await request(serverUrl, "/api/agents");
      setAgents(items);
      setError("");
    } catch (refreshError) {
      setError(refreshError.message);
    } finally {
      if (!options.silent) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    let cancelled = false;
    let intervalId = null;

    refreshAgents();
    intervalId = window.setInterval(() => {
      if (!cancelled) {
        refreshAgents({ silent: true });
      }
    }, 3000);

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
    };
  }, [serverUrl]);

  async function createAgent(name, platform, role, specialty = "") {
    const agent = await request(serverUrl, "/api/agents", {
      method: "POST",
      body: JSON.stringify({ name, platform, role, specialty })
    });

    await refreshAgents();
    return agent;
  }

  async function deleteAgent(agentId) {
    await request(serverUrl, `/api/agents/${agentId}`, {
      method: "DELETE"
    });

    setAgents((current) => current.filter((agent) => agent.id !== agentId));
  }

  async function markAgentStatus(agentId, status) {
    setAgents((current) =>
      current.map((agent) =>
        agent.id === agentId
          ? {
              ...agent,
              status
            }
          : agent
      )
    );

    await request(serverUrl, `/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status })
    });
  }

  async function updateAgentRole(agentId, role) {
    await request(serverUrl, `/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ role })
    });

    await refreshAgents();
  }

  async function updateAgentSpecialty(agentId, specialty) {
    await request(serverUrl, `/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ specialty })
    });

    await refreshAgents();
  }

  async function renameAgent(agentId, newName) {
    await request(serverUrl, `/api/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ name: newName })
    });
    await refreshAgents();
  }

  return {
    agents,
    loading,
    error,
    createAgent,
    deleteAgent,
    markAgentStatus,
    updateAgentRole,
    updateAgentSpecialty,
    renameAgent,
    refreshAgents
  };
}
