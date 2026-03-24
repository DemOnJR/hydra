import { Router } from "express";
import {
  finalizeToolCall,
  getToolExecutionByRequestId,
  listToolCalls,
  normalizeToolRequestEnvelope,
  prepareToolCall
} from "../core/toolCallLifecycle.js";
import {
  addTaskDependency,
  attachTaskArtifact,
  createReviewIssue,
  getTaskLifecycle,
  listRunnableTasks,
  listTaskArtifacts,
  listTaskDependencies,
  listTaskTimeline,
  markTaskVerification,
  transitionTaskState
} from "../core/taskLifecycle.js";
import {
  dispatchNextRunnableTask,
  getSchedulerSnapshot,
  heartbeatTaskLease,
  reconcileSchedulerState,
  revokeLease
} from "../core/scheduler.js";
import {
  listTrackedProcesses,
  readTrackedProcessOutput,
  restartProcess,
  startProcess,
  stopProcess
} from "../core/processManager.js";
import { capturePreview } from "../core/previewEngine.js";
import {
  activateEnvironment,
  createEnvironment,
  describeEnvironment,
  detectEnvironment,
  ensureRuntime,
  installDependencies
} from "../core/environmentManager.js";
import {
  deleteSecret,
  injectSecretRef,
  listSecretRefs,
  setSecret
} from "../core/secretsVault.js";
import {
  createGenesisTask,
  createMacroTool,
  describeTool,
  getRegistryMetrics,
  listCapabilityGaps,
  listToolVersions,
  listTools,
  promoteMacroToRegistry,
  registerCapabilityGap,
  rollbackToolVersion,
  updateGenesisTaskStatus
} from "../core/toolRegistryService.js";
import { getCoreMetrics, getTaskDebugArtifacts } from "../core/observability.js";
import { runVerification } from "../core/verificationRunner.js";

const router = Router();

router.post("/tool-calls/prepare", (req, res) => {
  try {
    const { envelope = {}, defaults = {}, approvalRequired = false, approved = true } = req.body ?? {};
    const normalizedEnvelope = normalizeToolRequestEnvelope(envelope, defaults);
    const prepared = prepareToolCall({
      envelope: normalizedEnvelope,
      approvalRequired: Boolean(approvalRequired),
      approved: Boolean(approved)
    });

    res.json(prepared);
  } catch (error) {
    res.status(400).json({
      error: error.message,
      code: "MALFORMED_PAYLOAD"
    });
  }
});

router.post("/tool-calls/finalize", (req, res) => {
  try {
    const { requestId, toolCallId = null, result = {}, sideEffect, summary = "", artifacts = {}, error = "" } = req.body ?? {};
    if (!requestId && !toolCallId) {
      res.status(400).json({ error: "requestId or toolCallId is required." });
      return;
    }

    const finalized = finalizeToolCall({
      requestId: requestId ? String(requestId).trim() : null,
      toolCallId: toolCallId ? String(toolCallId).trim() : null,
      result,
      sideEffect,
      summary,
      artifacts,
      error
    });

    res.json(finalized);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/tool-calls", (req, res) => {
  const filters = {
    projectId: req.query.projectId?.toString() || null,
    taskId: req.query.taskId?.toString() || null,
    status: req.query.status?.toString() || null,
    limit: Number.parseInt(req.query.limit?.toString() || "200", 10)
  };

  res.json(listToolCalls(filters));
});

router.get("/tool-calls/:requestId", (req, res) => {
  const execution = getToolExecutionByRequestId(req.params.requestId);
  if (!execution) {
    res.status(404).json({ error: "Tool call not found." });
    return;
  }

  res.json(execution);
});

router.get("/tasks/runnable", (req, res) => {
  const projectId = req.query.projectId?.toString() || null;
  const limit = Number.parseInt(req.query.limit?.toString() || "100", 10);
  res.json(listRunnableTasks(projectId, Number.isNaN(limit) ? 100 : limit));
});

router.get("/tasks/:taskId/lifecycle", (req, res) => {
  const lifecycle = getTaskLifecycle(req.params.taskId);
  if (!lifecycle) {
    res.status(404).json({ error: "Task not found." });
    return;
  }

  res.json(lifecycle);
});

router.get("/tasks/:taskId/timeline", (req, res) => {
  res.json(listTaskTimeline(req.params.taskId));
});

router.get("/tasks/:taskId/artifacts", (req, res) => {
  const limit = Number.parseInt(req.query.limit?.toString() || "200", 10);
  res.json(listTaskArtifacts(req.params.taskId, Number.isNaN(limit) ? 200 : limit));
});

router.post("/tasks/:taskId/artifacts", (req, res) => {
  try {
    const artifact = attachTaskArtifact({
      taskId: req.params.taskId,
      projectId: req.body?.projectId || null,
      artifactType: req.body?.artifactType,
      title: req.body?.title || "",
      filePath: req.body?.filePath || "",
      content: req.body?.content ?? null,
      receiptId: req.body?.receiptId || null,
      correlationId: req.body?.correlationId || ""
    });
    res.status(201).json(artifact);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/transition", (req, res) => {
  try {
    const task = transitionTaskState({
      taskId: req.params.taskId,
      toState: req.body?.toState,
      actorType: req.body?.actorType || "system",
      actorId: req.body?.actorId || "",
      reason: req.body?.reason || "",
      correlationId: req.body?.correlationId || "",
      bypassGuards: Boolean(req.body?.bypassGuards)
    });
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/dependencies", (req, res) => {
  try {
    const dependencies = addTaskDependency(req.params.taskId, req.body?.dependsOnTaskId);
    res.status(201).json(dependencies);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/tasks/:taskId/dependencies", (req, res) => {
  res.json(listTaskDependencies(req.params.taskId));
});

router.post("/tasks/:taskId/review-issues", (req, res) => {
  try {
    const issue = createReviewIssue({
      taskId: req.params.taskId,
      projectId: req.body?.projectId,
      issueType: req.body?.issueType,
      title: req.body?.title,
      details: req.body?.details || "",
      artifactId: req.body?.artifactId || null
    });
    res.status(201).json(issue);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/verification", async (req, res) => {
  try {
    const verification = await runVerification({
      taskId: req.params.taskId,
      projectId: req.body?.projectId || null,
      projectRoot: req.body?.projectRoot,
      commands: req.body?.commands,
      archetype: req.body?.archetype || null,
      timeoutMs: req.body?.timeoutMs || 600000
    });

    res.json(verification);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/tasks/:taskId/verification-status", (req, res) => {
  try {
    const task = markTaskVerification(req.params.taskId, req.body?.status, req.body?.details);
    res.json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/scheduler/dispatch", (req, res) => {
  try {
    const result = dispatchNextRunnableTask({
      agentId: req.body?.agentId,
      projectId: req.body?.projectId || null,
      leaseMs: req.body?.leaseMs || 45000,
      maxConcurrency: req.body?.maxConcurrency || 1,
      correlationId: req.body?.correlationId || ""
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/scheduler/heartbeat", (req, res) => {
  try {
    const result = heartbeatTaskLease({
      assignmentId: req.body?.assignmentId,
      leaseId: req.body?.leaseId,
      leaseMs: req.body?.leaseMs || 45000
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/scheduler/release", (req, res) => {
  const result = revokeLease(req.body?.assignmentId, req.body?.status || "released");
  res.json(result);
});

router.post("/scheduler/reconcile", (_req, res) => {
  res.json(reconcileSchedulerState());
});

router.get("/scheduler/snapshot", (req, res) => {
  res.json(getSchedulerSnapshot(req.query.projectId?.toString() || null));
});

router.post("/processes/start", async (req, res) => {
  try {
    const result = await startProcess({
      taskId: req.body?.taskId || null,
      projectId: req.body?.projectId || null,
      ownerAgentId: req.body?.ownerAgentId || null,
      command: req.body?.command,
      cwd: req.body?.cwd,
      env: req.body?.env || {},
      autoRestart: Boolean(req.body?.autoRestart),
      metadata: req.body?.metadata || {}
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/processes/:processId/stop", async (req, res) => {
  try {
    const result = await stopProcess(req.params.processId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/processes/:processId/restart", async (req, res) => {
  try {
    const result = await restartProcess(req.params.processId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/processes", (req, res) => {
  res.json(
    listTrackedProcesses({
      projectId: req.query.projectId?.toString() || null,
      taskId: req.query.taskId?.toString() || null,
      state: req.query.state?.toString() || null
    })
  );
});

router.get("/processes/:processId/output", (req, res) => {
  const limit = Number.parseInt(req.query.limit?.toString() || "500", 10);
  const afterId = Number.parseInt(req.query.afterId?.toString() || "0", 10);
  res.json(
    readTrackedProcessOutput(req.params.processId, {
      limit: Number.isNaN(limit) ? 500 : limit,
      afterId: Number.isNaN(afterId) ? 0 : afterId
    })
  );
});

router.post("/preview/capture", async (req, res) => {
  try {
    const result = await capturePreview({
      taskId: req.body?.taskId || null,
      projectId: req.body?.projectId || null,
      url: req.body?.url,
      waitMs: req.body?.waitMs ?? 1500,
      fullPage: req.body?.fullPage ?? true,
      viewport: req.body?.viewport || { width: 1400, height: 900 }
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/environment/detect", async (req, res) => {
  try {
    const result = await detectEnvironment({
      projectId: req.body?.projectId,
      projectRoot: req.body?.projectRoot
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/environment/ensure-runtime", async (req, res) => {
  try {
    const result = await ensureRuntime({
      runtimeFamily: req.body?.runtimeFamily,
      runtimeVersion: req.body?.runtimeVersion || ""
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/environment/create", async (req, res) => {
  try {
    const result = await createEnvironment({
      profileId: req.body?.profileId || null,
      projectRoot: req.body?.projectRoot || null,
      runtimeFamily: req.body?.runtimeFamily || null
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/environment/install", async (req, res) => {
  try {
    const result = await installDependencies({
      profileId: req.body?.profileId,
      projectRoot: req.body?.projectRoot
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/environment/activate", (req, res) => {
  try {
    const result = activateEnvironment({
      profileId: req.body?.profileId
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/environment/describe", (req, res) => {
  try {
    const result = describeEnvironment({
      profileId: req.query.profileId?.toString() || null,
      projectId: req.query.projectId?.toString() || null
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/secrets/set", (req, res) => {
  try {
    const result = setSecret({
      projectId: req.body?.projectId,
      name: req.body?.name,
      value: req.body?.value,
      backend: req.body?.backend || "vault_file"
    });
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/secrets", (req, res) => {
  const projectId = req.query.projectId?.toString();
  if (!projectId) {
    res.status(400).json({ error: "projectId is required." });
    return;
  }

  res.json(listSecretRefs(projectId));
});

router.delete("/secrets", (req, res) => {
  try {
    const result = deleteSecret({
      projectId: req.body?.projectId,
      name: req.body?.name
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/secrets/inject", (req, res) => {
  try {
    const result = injectSecretRef({
      projectId: req.body?.projectId,
      name: req.body?.name,
      envKey: req.body?.envKey
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/tools", (req, res) => {
  res.json(
    listTools({
      status: req.query.status?.toString() || null,
      source: req.query.source?.toString() || null,
      name: req.query.name?.toString() || null
    })
  );
});

router.get("/tools/:name/versions", (req, res) => {
  res.json(listToolVersions(req.params.name));
});

router.post("/tools/:name/rollback", (req, res) => {
  try {
    const tool = rollbackToolVersion(req.params.name, req.body?.targetVersion || null);
    res.json(tool);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/tools/:name", (req, res) => {
  const tool = describeTool(req.params.name, {
    version: req.query.version?.toString() || ""
  });

  if (!tool) {
    res.status(404).json({ error: "Tool not found." });
    return;
  }

  res.json(tool);
});

router.get("/capability-gaps", (req, res) => {
  res.json(
    listCapabilityGaps({
      projectId: req.query.projectId?.toString() || null,
      status: req.query.status?.toString() || null,
      category: req.query.category?.toString() || null
    })
  );
});

router.post("/capability-gaps", (req, res) => {
  try {
    const gap = registerCapabilityGap({
      taskId: req.body?.taskId || null,
      projectId: req.body?.projectId || null,
      description: req.body?.description,
      workaroundAttempted: req.body?.workaroundAttempted || "",
      proposedToolName: req.body?.proposedToolName || "",
      category: req.body?.category || "general"
    });
    res.status(201).json(gap);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/genesis-tasks", (req, res) => {
  try {
    const task = createGenesisTask({
      taskId: req.body?.taskId || null,
      projectId: req.body?.projectId || null,
      proposedToolName: req.body?.proposedToolName,
      description: req.body?.description || "",
      sourcePath: req.body?.sourcePath || ".hydra/tools",
      testsPath: req.body?.testsPath || ".hydra/tools/tests"
    });

    res.status(201).json(task);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.patch("/genesis-tasks/:id/status", (req, res) => {
  try {
    const updated = updateGenesisTaskStatus(req.params.id, req.body?.status, {
      promoted_tool_id: req.body?.promotedToolId || null,
      test_receipt_ids: req.body?.testReceiptIds || null
    });
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/macro-tools", (req, res) => {
  try {
    const macro = createMacroTool({
      name: req.body?.name,
      version: req.body?.version || "1.0.0",
      steps: req.body?.steps,
      schema: req.body?.schema || {},
      createdByTask: req.body?.createdByTask || null,
      status: req.body?.status || "pending_approval"
    });
    res.status(201).json(macro);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/macro-tools/:id/promote", (req, res) => {
  try {
    const tool = promoteMacroToRegistry(req.params.id, req.body?.sourceTaskId || null);
    res.json(tool);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get("/observability/metrics", (req, res) => {
  res.json(getCoreMetrics(req.query.projectId?.toString() || null));
});

router.get("/observability/task/:taskId", (req, res) => {
  res.json(getTaskDebugArtifacts(req.params.taskId));
});

router.get("/observability/registry", (_req, res) => {
  res.json(getRegistryMetrics());
});

export default router;
