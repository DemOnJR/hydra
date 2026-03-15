export const AI_ROLE_KEYS = ["orchestrator", "builder", "reviewer", "tester"];

export const DEFAULT_MODELS = {
  orchestrator: "gpt-4o",
  builder: "claude-sonnet-4-6",
  reviewer: "claude-sonnet-4-6",
  tester: "gpt-4o-mini"
};

export const MODEL_CATALOG = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-5.2"],
  anthropic: [
    "claude-sonnet-4-6",
    "claude-sonnet-4-5-20250929",
    "claude-opus-4-1-20250805"
  ],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"]
};

export const PROVIDER_CAPABILITIES = {
  openai: {
    supportsCalls: true
  },
  anthropic: {
    supportsCalls: true
  },
  google: {
    supportsCalls: false,
    note: "Gemini caller is not implemented yet."
  }
};

export function isAiRole(value) {
  return AI_ROLE_KEYS.includes(value);
}

export function getProviderForModel(model = "") {
  const normalized = model.trim().toLowerCase();

  if (
    normalized.startsWith("gpt") ||
    normalized.startsWith("o1") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("chatgpt")
  ) {
    return "openai";
  }

  if (normalized.startsWith("claude")) {
    return "anthropic";
  }

  if (normalized.startsWith("gemini")) {
    return "google";
  }

  throw new Error(`Unknown model provider for "${model}".`);
}

export function sanitizeModelPatch(input = {}) {
  const patch = {};

  for (const role of AI_ROLE_KEYS) {
    const value = input[role];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`Model for "${role}" must be a non-empty string.`);
    }

    patch[role] = value.trim();
  }

  return patch;
}

export function formatModelSettings(row = {}) {
  return {
    orchestrator: row.orchestrator ?? row.orchestrator_model ?? DEFAULT_MODELS.orchestrator,
    builder: row.builder ?? row.builder_model ?? DEFAULT_MODELS.builder,
    reviewer: row.reviewer ?? row.reviewer_model ?? DEFAULT_MODELS.reviewer,
    tester: row.tester ?? row.tester_model ?? DEFAULT_MODELS.tester
  };
}

export function toDbModelPatch(modelPatch = {}) {
  const dbPatch = {};

  for (const [role, value] of Object.entries(modelPatch)) {
    if (isAiRole(role)) {
      dbPatch[`${role}_model`] = value;
    }
  }

  return dbPatch;
}

export function getModelForRole(role, overrideSettings = {}) {
  if (!isAiRole(role)) {
    throw new Error(`Unknown AI role "${role}".`);
  }

  const settings = formatModelSettings(overrideSettings);
  return settings[role];
}
