import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import {
  getActiveProject,
  getAllProjects,
  getProjectById,
  getProjectContext,
  getRecentDecisions,
  saveDecisions,
  searchContext,
  setActiveProject
} from "./db/queries.js";

function formatProjectContext(project, context, decisions) {
  const blocks = [`# Project: ${project.name}`];

  if (project.description) {
    blocks.push(`## Description\n${project.description}`);
  }

  if (context.architecture) {
    blocks.push(`## Architecture\n${context.architecture}`);
  }

  if (context.tech_stack) {
    blocks.push(`## Tech Stack\n${context.tech_stack}`);
  }

  if (context.conventions) {
    blocks.push(`## Conventions\n${context.conventions}`);
  }

  if (decisions.length > 0) {
    blocks.push(
      `## Recent Decisions\n${decisions
        .map((decision) => `- ${decision.title} [${decision.category}]: ${decision.content}`)
        .join("\n")}`
    );
  }

  return blocks.join("\n\n");
}

function createServer() {
  const server = new McpServer({
    name: "agent-sync",
    version: "0.1.0"
  });

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description: "List all available AgentSync projects.",
      inputSchema: {}
    },
    async () => {
      const projects = getAllProjects();
      const text = projects.length
        ? projects
            .map((project) => {
              const active = project.is_active ? " [ACTIVE]" : "";
              return `- ${project.name} (${project.id})${active}`;
            })
            .join("\n")
        : "No projects found.";

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  server.registerTool(
    "get_project_context",
    {
      title: "Get Project Context",
      description: "Return the structured knowledge base for the active project or a specific project.",
      inputSchema: {
        project_id: z.string().optional()
      }
    },
    async ({ project_id }) => {
      const project = project_id ? getProjectById(project_id) : getActiveProject();

      if (!project) {
        return {
          content: [{ type: "text", text: "No active project is configured." }]
        };
      }

      const context = getProjectContext(project.id);
      const decisions = getRecentDecisions(project.id, 10);

      return {
        content: [
          {
            type: "text",
            text: formatProjectContext(project, context, decisions)
          }
        ]
      };
    }
  );

  server.registerTool(
    "save_decisions",
    {
      title: "Save Decisions",
      description: "Persist one or more project decisions into the knowledge base.",
      inputSchema: {
        project_id: z.string().optional(),
        decisions: z.array(
          z.object({
            title: z.string(),
            content: z.string(),
            category: z
              .enum(["architecture", "convention", "bug-fix", "dependency", "other"])
              .optional()
          })
        )
      }
    },
    async ({ project_id, decisions }) => {
      const project = project_id ? getProjectById(project_id) : getActiveProject();

      if (!project) {
        return {
          content: [{ type: "text", text: "No active project is configured." }]
        };
      }

      const saved = saveDecisions(project.id, decisions);
      return {
        content: [
          {
            type: "text",
            text: `Saved ${saved.length} decision(s) to ${project.name}.`
          }
        ]
      };
    }
  );

  server.registerTool(
    "set_active_project",
    {
      title: "Set Active Project",
      description: "Change the active AgentSync project.",
      inputSchema: {
        project_id: z.string()
      }
    },
    async ({ project_id }) => {
      const project = setActiveProject(project_id);

      if (!project) {
        return {
          content: [{ type: "text", text: "Project not found." }]
        };
      }

      return {
        content: [{ type: "text", text: `Active project set to ${project.name}.` }]
      };
    }
  );

  server.registerTool(
    "search_context",
    {
      title: "Search Context",
      description: "Search saved decisions for a term.",
      inputSchema: {
        query: z.string(),
        project_id: z.string().optional()
      }
    },
    async ({ query, project_id }) => {
      const project = project_id ? getProjectById(project_id) : getActiveProject();

      if (!project) {
        return {
          content: [{ type: "text", text: "No active project is configured." }]
        };
      }

      const results = searchContext(project.id, query);
      const text = results.length
        ? results
            .map(
              (item) =>
                `### ${item.title}\n${item.content}\n(${item.category}, ${item.created_at})`
            )
            .join("\n\n")
        : `No results for "${query}".`;

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  return server;
}

export function registerMcpRoutes(app, authorizeRequest) {
  app.all("/mcp", async (req, res) => {
    if (!authorizeRequest(req, res)) {
      return;
    }

    if (req.method !== "POST") {
      res.status(405).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed."
        },
        id: null
      });
      return;
    }

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    res.on("close", async () => {
      await transport.close();
      await server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[MCP] Request failed", error);

      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error."
          },
          id: null
        });
      }
    }
  });
}

