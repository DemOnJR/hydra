import { parentPort, workerData } from "node:worker_threads";
import { pipeline, TextStreamer } from "@huggingface/transformers";

const { model, systemPrompt, messages, maxTokens, temperature } = workerData;

async function run() {
  try {
    const generator = await pipeline("text-generation", model, {
      device: "cpu",
      dtype: "q4",
      progress_callback: (info) => {
        if (info.status === "progress") {
          parentPort.postMessage({ type: "progress", info });
        }
      }
    });

    const chatMessages = [];
    if (systemPrompt) {
      chatMessages.push({ role: "system", content: systemPrompt });
    }
    for (const msg of messages) {
      chatMessages.push({ role: msg.role, content: msg.content });
    }

    const streamer = new TextStreamer(generator.tokenizer, {
      on_token_callback: (token) => {
        if (typeof token === "string" && token.length > 0) {
          parentPort.postMessage({ type: "token", token });
        }
      },
      skip_prompt: true,
      skip_special_tokens: true
    });

    const output = await generator(chatMessages, {
      max_new_tokens: maxTokens,
      temperature: temperature,
      do_sample: temperature > 0,
      streamer: streamer,
      return_full_text: false
    });

    let text = "";
    const generated = output[0]?.generated_text;

    if (Array.isArray(generated)) {
      const lastMessage = generated[generated.length - 1];
      text = lastMessage?.role === "assistant" ? lastMessage.content : "";
    } else {
      text = String(generated || "");
    }

    parentPort.postMessage({ type: "done", text });
  } catch (error) {
    parentPort.postMessage({ type: "error", error: error.message });
  }
}

run();
