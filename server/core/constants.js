export const TASK_STATES = {
  TODO: "todo",
  IN_PROGRESS: "in_progress",
  IN_REVIEW: "in_review",
  COMPLETE: "complete",
  BLOCKED: "blocked"
};

export const TASK_TRANSITIONS = {
  [TASK_STATES.TODO]: new Set([TASK_STATES.IN_PROGRESS]),
  [TASK_STATES.IN_PROGRESS]: new Set([TASK_STATES.IN_REVIEW, TASK_STATES.BLOCKED]),
  [TASK_STATES.IN_REVIEW]: new Set([TASK_STATES.COMPLETE, TASK_STATES.IN_PROGRESS]),
  [TASK_STATES.BLOCKED]: new Set([TASK_STATES.IN_PROGRESS]),
  [TASK_STATES.COMPLETE]: new Set()
};

export const PROCESS_STATES = {
  STARTING: "starting",
  RUNNING: "running",
  STOPPED: "stopped",
  FAILED: "failed",
  ZOMBIE: "zombie"
};

export const TOOL_CALL_STATES = {
  REQUESTED: "requested",
  APPROVED: "approved",
  REJECTED: "rejected",
  EXECUTED: "executed",
  RECEIPTED: "receipted",
  ATTACHED_TO_TASK: "attached_to_task",
  FAILED: "failed"
};

export const TOOL_SOURCE = {
  CORE: "core",
  GENESIS: "genesis",
  MACRO: "macro"
};

export const TOOL_STATUS = {
  DRAFT: "draft",
  TESTING: "testing",
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  DEPRECATED: "deprecated",
  ARCHIVED: "archived"
};

export const REVIEW_ISSUE_TYPES = new Set([
  "bug",
  "error",
  "wrong_logic",
  "optimization",
  "missing_tests"
]);

export const CORE_TOOL_DEFINITIONS = [
  {
    name: "list_files",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        dir: "string?",
        maxDepth: "number?"
      },
      output: {
        output: "string"
      }
    }
  },
  {
    name: "search_files",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        dir: "string?",
        pattern: "string"
      },
      output: {
        output: "string"
      }
    }
  },
  {
    name: "read_file",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        path: "string"
      },
      output: {
        content: "string"
      }
    }
  },
  {
    name: "read_file_lines",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        path: "string",
        startLine: "number?",
        endLine: "number?"
      },
      output: {
        path: "string",
        startLine: "number",
        endLine: "number",
        content: "string"
      }
    }
  },
  {
    name: "read_files",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        paths: "array"
      },
      output: {
        files: "array"
      }
    }
  },
  {
    name: "batch_actions",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        actions: "array"
      },
      output: {
        results: "array"
      }
    }
  },
  {
    name: "write_file",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        path: "string",
        content: "string"
      },
      output: {
        filename: "string"
      }
    }
  },
  {
    name: "replace",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        path: "string",
        oldString: "string",
        newString: "string"
      },
      output: {
        filename: "string",
        diff: "string"
      }
    }
  },
  {
    name: "apply_patch",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        patch: "string"
      },
      output: {
        filesChanged: "array"
      }
    }
  },
  {
    name: "run_command",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        cmd: "string"
      },
      output: {
        exitCode: "number",
        stdout: "string",
        stderr: "string"
      }
    }
  },
  {
    name: "start_process",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        command: "string",
        cwd: "string?"
      },
      output: {
        processId: "string",
        pid: "number"
      }
    }
  },
  {
    name: "stop_process",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        processId: "string"
      },
      output: {
        state: "string"
      }
    }
  },
  {
    name: "restart_process",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        processId: "string"
      },
      output: {
        pid: "number",
        state: "string"
      }
    }
  },
  {
    name: "read_process_output",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        processId: "string",
        limit: "number?"
      },
      output: {
        lines: "array"
      }
    }
  },
  {
    name: "list_processes",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        projectId: "string?",
        taskId: "string?"
      },
      output: {
        items: "array"
      }
    }
  },
  {
    name: "detect_environment",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        projectRoot: "string"
      },
      output: {
        runtimeFamily: "string"
      }
    }
  },
  {
    name: "ensure_runtime",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        runtimeFamily: "string",
        runtimeVersion: "string?"
      },
      output: {
        available: "boolean"
      }
    }
  },
  {
    name: "create_environment",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        projectRoot: "string",
        runtimeFamily: "string"
      },
      output: {
        environmentPath: "string"
      }
    }
  },
  {
    name: "install_dependencies",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        projectRoot: "string",
        runtimeFamily: "string"
      },
      output: {
        exitCode: "number"
      }
    }
  },
  {
    name: "activate_environment",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        profileId: "string"
      },
      output: {
        env: "object"
      }
    }
  },
  {
    name: "describe_environment",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        profileId: "string"
      },
      output: {
        profile: "object"
      }
    }
  },
  {
    name: "set_secret",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "destructive",
    schema: {
      input: {
        projectId: "string",
        name: "string",
        value: "string"
      },
      output: {
        refId: "string"
      }
    }
  },
  {
    name: "list_secret_refs",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        projectId: "string"
      },
      output: {
        refs: "array"
      }
    }
  },
  {
    name: "delete_secret",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "destructive",
    schema: {
      input: {
        projectId: "string",
        name: "string"
      },
      output: {
        deleted: "boolean"
      }
    }
  },
  {
    name: "inject_secret_ref",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        projectId: "string",
        name: "string",
        envKey: "string"
      },
      output: {
        env: "object"
      }
    }
  },
  {
    name: "list_tools",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        status: "string?",
        source: "string?",
        name: "string?"
      },
      output: {
        items: "array"
      }
    }
  },
  {
    name: "describe_tool",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        name: "string",
        version: "string?"
      },
      output: {
        tool: "object"
      }
    }
  },
  {
    name: "list_tool_versions",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        name: "string"
      },
      output: {
        versions: "array"
      }
    }
  },
  {
    name: "list_capability_gaps",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "read_only",
    schema: {
      input: {
        projectId: "string?",
        status: "string?",
        category: "string?"
      },
      output: {
        gaps: "array"
      }
    }
  },
  {
    name: "emit_capability_gap",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        taskId: "string?",
        projectId: "string?",
        description: "string",
        workaroundAttempted: "string?",
        proposedToolName: "string?",
        category: "string?"
      },
      output: {
        gap: "object"
      }
    }
  },
  {
    name: "capture_preview",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        taskId: "string?",
        projectId: "string?",
        url: "string"
      },
      output: {
        screenshotPath: "string"
      }
    }
  },
  {
    name: "run_verification",
    version: "core",
    source: TOOL_SOURCE.CORE,
    status: TOOL_STATUS.ACTIVE,
    safety: "side_effect",
    schema: {
      input: {
        taskId: "string",
        projectId: "string?",
        projectRoot: "string",
        commands: "array?"
      },
      output: {
        ok: "boolean",
        commands: "array"
      }
    }
  }
];

const READ_ONLY_TOOL_ACTIONS = new Set([
  "list_files",
  "search_files",
  "read_file",
  "read_file_lines",
  "read_files",
  "batch_actions",
  "read_process_output",
  "list_processes",
  "detect_environment",
  "describe_environment",
  "list_tools",
  "describe_tool",
  "list_tool_versions",
  "list_capability_gaps",
  "list_secret_refs"
]);

export function isReadOnlyToolAction(action) {
  return READ_ONLY_TOOL_ACTIONS.has(String(action || "").trim());
}
