function formatToolList() {
  return [
    "list_files(dir?): Structure",
    "read_file(path): Contents",
    "run_command(cmd): Diagnostics",
    "git_status(): Branch info",
    "get_diff(): Changes",
    "search_context(query): KB Search",
    "save_decision(title, content): Save Logic",
    "add_todo(title, priority): Tasks",
    "request_approval(summary): User Pause"
  ].join(", ");
}

function formatTodos(todos) {
  return todos.length 
    ? todos.map(t => `- [${t.priority}] ${t.title}`).join("\n")
    : "No tasks.";
}

function formatConversation(turns) {
  return (turns || []).map(t => `${t.speaker === 'user' ? 'USER' : 'HYDRA'}: ${t.content}`).join("\n");
}

export function buildOrchestratorPrompt({ project, gitLog, testResults, todos, files, recentTurns }) {
  return `
Role: HYDRA, Project Intelligence for "${project.name}".
Status: ${project.mode} mode. Path: ${project.rootPath}.${project.githubLink ? ` GitHub: ${project.githubLink}.` : ""}
Git: ${gitLog.branch}.

History:
${formatConversation(recentTurns)}

Files:
${files}

Pending Tasks:
${formatTodos(todos)}

Capabilities (Tools): ${formatToolList()}

Instructions:
1. Be extremely concise.
2. If you need info, use a tool.
3. If you are replying to a greeting, just say hello.
4. Do not invent tool results. Only use the tools provided.
5. Finish work with: "FINAL SUMMARY: [result]".

Response:`.trim();
}
