function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeUsage(provider, usage) {
  if (!usage || typeof usage !== "object") {
    return null;
  }

  if (provider === "openai" || provider === "ollama") {
    const promptTokens = safeNumber(usage.prompt_tokens) ?? safeNumber(usage.promptTokens);
    const completionTokens = safeNumber(usage.completion_tokens) ?? safeNumber(usage.completionTokens);
    const totalTokens = safeNumber(usage.total_tokens) ?? safeNumber(usage.totalTokens);

    if (promptTokens == null && completionTokens == null && totalTokens == null) {
      return null;
    }

    const derivedTotal =
      totalTokens ??
      (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);

    return {
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      totalTokens: derivedTotal
    };
  }

  if (provider === "anthropic") {
    const promptTokens = safeNumber(usage.input_tokens) ?? safeNumber(usage.inputTokens);
    const completionTokens = safeNumber(usage.output_tokens) ?? safeNumber(usage.outputTokens);

    if (promptTokens == null && completionTokens == null) {
      return null;
    }

    return {
      promptTokens: promptTokens ?? null,
      completionTokens: completionTokens ?? null,
      totalTokens:
        promptTokens != null && completionTokens != null
          ? promptTokens + completionTokens
          : null
    };
  }

  return null;
}

// USD per 1M tokens.
// These are estimates and may drift over time; allow overrides via HYDRA_PRICING_OVERRIDES_JSON.
const BASE_PRICE_BOOK = {
  openai: {
    "gpt-4o": { input: 5.0, output: 15.0 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 5.0, output: 15.0 },
    "gpt-4.1-mini": { input: 0.15, output: 0.6 }
  },
  anthropic: {
    "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
    "claude-opus-4-1-20250805": { input: 15.0, output: 75.0 }
  }
};

function loadOverrides() {
  const raw = process.env.HYDRA_PRICING_OVERRIDES_JSON?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getPriceBook() {
  const overrides = loadOverrides();
  if (!overrides) {
    return BASE_PRICE_BOOK;
  }

  return {
    ...BASE_PRICE_BOOK,
    ...overrides,
    openai: {
      ...BASE_PRICE_BOOK.openai,
      ...(overrides.openai || {})
    },
    anthropic: {
      ...BASE_PRICE_BOOK.anthropic,
      ...(overrides.anthropic || {})
    }
  };
}

export function estimateCostUsd({ provider, model, usageNormalized }) {
  if (!provider || !model || !usageNormalized) {
    return null;
  }

  const promptTokens = usageNormalized.promptTokens;
  const completionTokens = usageNormalized.completionTokens;

  if (promptTokens == null && completionTokens == null) {
    return null;
  }

  const book = getPriceBook();
  const modelPrices = book?.[provider]?.[model];

  if (!modelPrices) {
    return null;
  }

  const inputRate = safeNumber(modelPrices.input);
  const outputRate = safeNumber(modelPrices.output);

  if (inputRate == null || outputRate == null) {
    return null;
  }

  const cost =
    ((promptTokens ?? 0) * inputRate + (completionTokens ?? 0) * outputRate) / 1_000_000;

  return Number.isFinite(cost) ? cost : null;
}
