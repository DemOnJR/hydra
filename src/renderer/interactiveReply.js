function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function normalizeInlineText(value) {
  return normalizeWhitespace(value).replace(/\s+/g, " ");
}

function normalizeOptionLabel(value) {
  return normalizeInlineText(value)
    .replace(/^\d+\.\s*/, "")
    .replace(/^[-*]\s*/, "")
    .trim();
}

function dedupeOptions(options = []) {
  const seen = new Set();
  const result = [];

  for (const option of options) {
    const normalized = normalizeInlineText(option).toLowerCase();

    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalizeInlineText(option));
  }

  return result;
}

function normalizeQuestion(value) {
  return normalizeInlineText(value).replace(/^Q:\s*/i, "").trim();
}

function parseHydraReplyOptionBlocks(text) {
  const blocks = [];
  const blockPattern = /\[HYDRA_REPLY_OPTIONS\]([\s\S]*?)\[\/HYDRA_REPLY_OPTIONS\]/gi;
  let match = null;

  while ((match = blockPattern.exec(String(text ?? "")))) {
    const lines = normalizeWhitespace(match[1])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let question = "";
    let mode = "single";
    const options = [];

    for (const line of lines) {
      if (/^question\s*:/i.test(line)) {
        question = normalizeQuestion(line.replace(/^question\s*:/i, ""));
        continue;
      }

      if (/^mode\s*:/i.test(line)) {
        const nextMode = normalizeInlineText(line.replace(/^mode\s*:/i, "")).toLowerCase();
        mode = nextMode === "multi" ? "multi" : "single";
        continue;
      }

      if (/^option\s*:/i.test(line)) {
        options.push(normalizeOptionLabel(line.replace(/^option\s*:/i, "")));
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        options.push(normalizeOptionLabel(line));
      }
    }

    if (question && options.length >= 2) {
      blocks.push({
        question,
        mode,
        options: dedupeOptions(options)
      });
    }
  }

  return blocks;
}

function parseQuestionAnswerPairs(text) {
  const pairs = [];
  const normalized = normalizeWhitespace(text).replace(/\n+/g, " ");
  const pairPattern = /Q:\s*([\s\S]*?)\s+A:\s*([\s\S]*?)(?=\s+Q:\s*|$)/gi;
  let match = null;

  while ((match = pairPattern.exec(normalized))) {
    const question = normalizeQuestion(match[1]);
    const answer = normalizeInlineText(match[2]);

    if (!question || !answer) {
      continue;
    }

    pairs.push({ question, answer });
  }

  return pairs;
}

function parseQuestionLines(text) {
  return normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (/^Q:\s*/i.test(line)) {
        return normalizeQuestion(line);
      }

      return /\?$/.test(line) ? normalizeInlineText(line) : "";
    })
    .filter(Boolean);
}

function parseNumberedOptions(text) {
  const options = normalizeWhitespace(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^\d+\.\s+(.+)$/);
      return match ? normalizeOptionLabel(match[1]) : "";
    })
    .filter(Boolean);

  return dedupeOptions(options);
}

function toSentenceCase(value) {
  const text = normalizeInlineText(value);
  return text ? `${text.slice(0, 1).toUpperCase()}${text.slice(1)}` : "";
}

function parseOrOptions(question) {
  const normalized = normalizeQuestion(question)
    .replace(/\?+$/, "")
    .replace(/^[A-Za-z][A-Za-z ]{0,24}[\u2013\u2014:-]\s*/, "");
  const parts = normalized
    .split(/\s+or\s+/i)
    .map((part) => normalizeInlineText(part))
    .filter(Boolean);

  if (parts.length !== 2 || parts.some((part) => part.length > 80)) {
    return [];
  }

  return dedupeOptions(parts.map(toSentenceCase));
}

function inferFallbackPromptMode(question, options = []) {
  const normalizedQuestion = normalizeQuestion(question).toLowerCase();
  const optionCount = Array.isArray(options) ? options.length : 0;

  if (/select all|all that apply|multiple|one or more|any that apply/i.test(normalizedQuestion)) {
    return "multi";
  }

  if (optionCount >= 3) {
    if (
      /which of these|which of the following|what features|which features|which items|which tasks|which changes/i.test(
        normalizedQuestion
      )
    ) {
      return "multi";
    }

    if (/would you like me to implement|what should i build|what should i implement/i.test(normalizedQuestion)) {
      return "multi";
    }
  }

  return "single";
}

function parseFallbackPrompts(text) {
  const prompts = [];
  const questionLines = parseQuestionLines(text);
  const numberedOptions = parseNumberedOptions(text);

  for (const question of questionLines) {
    if (
      numberedOptions.length >= 2 &&
      /which|what|choose|select|pick|would you like/i.test(question)
    ) {
      prompts.push({
        question,
        mode: inferFallbackPromptMode(question, numberedOptions),
        options: numberedOptions
      });
      continue;
    }

    const orOptions = parseOrOptions(question);
    if (orOptions.length >= 2) {
      prompts.push({
        question,
        mode: "single",
        options: orOptions
      });
    }
  }

  const seen = new Set();
  return prompts.filter((prompt) => {
    const key = `${prompt.mode}:${prompt.question.toLowerCase()}:${prompt.options.join("|").toLowerCase()}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function extractInteractiveReplyState(text) {
  const source = normalizeWhitespace(text);

  if (!source) {
    return {
      awaitingInput: false,
      questionAnswerPairs: [],
      replyPrompts: [],
      summary: ""
    };
  }

  const questionAnswerPairs = parseQuestionAnswerPairs(source);
  const replyPrompts = parseHydraReplyOptionBlocks(source);
  const fallbackPrompts = replyPrompts.length === 0 ? parseFallbackPrompts(source) : [];
  const prompts = replyPrompts.length > 0 ? replyPrompts : fallbackPrompts;
  const summary =
    questionAnswerPairs[0]?.question ||
    prompts[0]?.question ||
    "";
  const awaitingInput =
    questionAnswerPairs.length > 0 ||
    prompts.length > 0 ||
    /(?:^|\n)\s*Q:\s*/i.test(source) ||
    /which .* would you like|select all that apply|choose one|pick one/i.test(source);

  return {
    awaitingInput,
    questionAnswerPairs,
    replyPrompts: prompts,
    summary
  };
}

export function buildInteractiveReplyMessage(pairs = [], note = "") {
  const normalizedPairs = Array.isArray(pairs)
    ? pairs
        .map((pair) => ({
          question: normalizeQuestion(pair?.question),
          answer: normalizeInlineText(pair?.answer)
        }))
        .filter((pair) => pair.question && pair.answer)
    : [];
  const lines = [
    "Continue from your last message and use these choices:",
    ...normalizedPairs.map((pair) => `- ${pair.question}: ${pair.answer}`),
    "",
    "Proceed with the implementation and do not ask the same questionnaire again."
  ];
  const normalizedNote = normalizeWhitespace(note);

  if (normalizedNote) {
    lines.push("", "Additional note:", normalizedNote);
  }

  return lines.join("\n");
}
