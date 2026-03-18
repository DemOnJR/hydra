import { Router } from "express";
import {
  AI_ROLE_KEYS,
  DEFAULT_MODELS,
  MODEL_CATALOG,
  PROVIDER_CAPABILITIES,
  sanitizeModelPatch
} from "../ai/modelConfig.js";
import {
  deleteApiKey,
  getKeyStorageInfo,
  getProviderStatuses,
  loadApiKeys,
  saveApiKey
} from "../ai/keyManager.js";
import { getAiSettings, updateAiSettings } from "../db/queries.js";
import { callAI } from "../ai/caller.js";

const router = Router();

router.post("/call", async (req, res) => {
  const { model, systemPrompt, messages, tools, responseFormat, stream } = req.body ?? {};

  if (!model) {
    res.status(400).json({ error: "Model is required." });
    return;
  }

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const result = await callAI({
        model,
        systemPrompt,
        messages,
        tools,
        responseFormat,
        onToken: (token) => {
          res.write(`data: ${JSON.stringify({ type: "token", token })}\n\n`);
        },
        onProgress: (info) => {
          res.write(`data: ${JSON.stringify({ type: "progress", info })}\n\n`);
        }
      });
      res.write(`data: ${JSON.stringify({ type: "done", result })}\n\n`);
      res.end();
    } catch (error) {
      console.error("[AI Route] Stream failed:", error);
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
    return;
  }

  try {
    const result = await callAI({
      model,
      systemPrompt,
      messages,
      tools,
      responseFormat
    });
    res.json(result);
  } catch (error) {
    console.error("[AI Route] Call failed:", error);
    res.status(500).json({ error: error.message });
  }
});

router.get("/", async (_req, res) => {
  try {
    await loadApiKeys();

    res.json({
      roles: AI_ROLE_KEYS,
      defaults: DEFAULT_MODELS,
      settings: getAiSettings(),
      catalog: MODEL_CATALOG,
      providers: await getProviderStatuses(),
      storage: await getKeyStorageInfo(),
      capabilities: PROVIDER_CAPABILITIES
    });
  } catch (error) {
    console.error("[AI Route] Failed to load AI settings", error);
    res.status(500).json({ error: "Failed to load AI settings." });
  }
});

router.put("/", (req, res) => {
  try {
    const patch = sanitizeModelPatch(req.body ?? {});

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "At least one model override is required." });
      return;
    }

    res.json(updateAiSettings(patch));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post("/keys/:provider", async (req, res) => {
  try {
    const { apiKey } = req.body ?? {};

    if (!apiKey?.trim()) {
      res.status(400).json({ error: "apiKey is required." });
      return;
    }

    const status = await saveApiKey(req.params.provider, apiKey);
    res.status(201).json(status);
  } catch (error) {
    const statusCode = error.message.includes("Unsupported provider") ? 400 : 503;
    res.status(statusCode).json({ error: error.message });
  }
});

router.delete("/keys/:provider", async (req, res) => {
  try {
    const status = await deleteApiKey(req.params.provider);
    res.json(status);
  } catch (error) {
    const statusCode = error.message.includes("Unsupported provider") ? 400 : 500;
    res.status(statusCode).json({ error: error.message });
  }
});

export default router;
