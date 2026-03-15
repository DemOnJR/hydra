import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getProviderForModel } from "./modelConfig.js";

function ensureApiKey(envVarName) {
  if (!process.env[envVarName]?.trim()) {
    throw new Error(`Missing ${envVarName}. Configure the provider before making AI calls.`);
  }
}

function normalizeTextContent(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") {
          return block;
        }

        if (block?.type === "text") {
          return block.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function normalizeStructuredContent(content) {
  if (Array.isArray(content)) {
    return content;
  }

  if (typeof content === "string") {
    return content;
  }

  if (content == null) {
    return "";
  }

  return normalizeTextContent(content);
}

function safeParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatOpenAiTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: "object",
        properties: tool.parameters ?? {},
        required: Object.keys(tool.parameters ?? {})
      }
    }
  }));
}

function formatClaudeTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: "object",
      properties: tool.parameters ?? {},
      required: Object.keys(tool.parameters ?? {})
    }
  }));
}

function normalizeOpenAiMessages(messages, systemPrompt, responseFormat) {
  const normalized = [];
  let instructions = systemPrompt?.trim() ?? "";

  if (responseFormat === "json") {
    instructions = instructions
      ? `${instructions}\n\nRespond with valid JSON only.`
      : "Respond with valid JSON only.";
  }

  if (instructions) {
    normalized.push({
      role: "system",
      content: instructions
    });
  }

  for (const message of messages ?? []) {
    if (!message?.role) {
      continue;
    }

    if (message.role === "tool") {
      normalized.push({
        role: "tool",
        tool_call_id: message.tool_call_id,
        content:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content ?? "")
      });
      continue;
    }

    if (message.role === "assistant" && Array.isArray(message.tool_calls)) {
      normalized.push({
        role: "assistant",
        content: normalizeTextContent(message.content),
        tool_calls: message.tool_calls
      });
      continue;
    }

    normalized.push({
      role: message.role,
      content: normalizeTextContent(message.content)
    });
  }

  return normalized;
}

function normalizeClaudeMessages(messages) {
  return (messages ?? [])
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: normalizeStructuredContent(message.content)
    }));
}

async function callOpenAI({ model, systemPrompt, messages, tools, responseFormat }) {
  ensureApiKey("OPENAI_API_KEY");

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const params = {
    model,
    messages: normalizeOpenAiMessages(messages, systemPrompt, responseFormat)
  };

  if (tools.length > 0) {
    params.tools = formatOpenAiTools(tools);
    params.tool_choice = "auto";
  }

  if (responseFormat === "json") {
    params.response_format = { type: "json_object" };
  }

  const response = await client.chat.completions.create(params);
  const choice = response.choices[0];

  return {
    provider: "openai",
    text: normalizeTextContent(choice?.message?.content),
    toolCalls:
      choice?.message?.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function.name,
        params: safeParseJson(toolCall.function.arguments)
      })) ?? [],
    assistantMessage: {
      role: "assistant",
      content: choice?.message?.content ?? "",
      tool_calls: choice?.message?.tool_calls ?? []
    },
    usage: response.usage ?? null,
    finishReason: choice?.finish_reason ?? null
  };
}

async function callClaude({ model, systemPrompt, messages, tools, responseFormat }) {
  ensureApiKey("ANTHROPIC_API_KEY");

  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
  });

  const promptSuffix =
    responseFormat === "json" ? "\n\nRespond with valid JSON only." : "";

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    system: `${systemPrompt?.trim() ?? ""}${promptSuffix}`.trim() || undefined,
    messages: normalizeClaudeMessages(messages),
    tools: tools.length > 0 ? formatClaudeTools(tools) : undefined
  });

  const textBlocks = response.content.filter((block) => block.type === "text");
  const toolBlocks = response.content.filter((block) => block.type === "tool_use");

  return {
    provider: "anthropic",
    text: textBlocks.map((block) => block.text).join(""),
    toolCalls: toolBlocks.map((block) => ({
      id: block.id,
      name: block.name,
      params: block.input
    })),
    assistantMessage: {
      role: "assistant",
      content: response.content
    },
    usage: response.usage ?? null,
    finishReason: response.stop_reason ?? null
  };
}

export async function callAI({
  model,
  systemPrompt = "",
  messages = [],
  tools = [],
  responseFormat = "text"
}) {
  if (!model?.trim()) {
    throw new Error("AI model is required.");
  }

  const provider = getProviderForModel(model);

  if (provider === "openai") {
    return callOpenAI({
      model,
      systemPrompt,
      messages,
      tools,
      responseFormat
    });
  }

  if (provider === "anthropic") {
    return callClaude({
      model,
      systemPrompt,
      messages,
      tools,
      responseFormat
    });
  }

  if (provider === "google") {
    throw new Error("Gemini caller is not implemented yet.");
  }

  throw new Error(`Unsupported provider "${provider}".`);
}
