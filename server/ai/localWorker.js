import { parentPort } from "node:worker_threads";
import { pipeline, TextStreamer, env } from "@huggingface/transformers";
import os from "node:os";

// Maximum performance configuration
env.allowRemoteModels = true;
env.cacheDir = "./.cache";

// Get physical core count for maximum efficiency
const coreCount = os.cpus().length;

let activePipeline = null;
let activeModelName = null;
let blacklistedDevices = new Set();

async function getPipeline(model, device) {
  console.info(`[Local AI Worker] Performance Mode: Loading ${model} on ${device} using ${coreCount} threads...`);
  
  return await pipeline("text-generation", model, {
    device: device,
    dtype: "q4", // 4-bit quantization is the fastest for local RAM usage
    session_options: {
      intra_op_num_threads: coreCount,
      inter_op_num_threads: coreCount,
      execution_mode: "sequential",
      graph_optimization_level: "all"
    },
    progress_callback: (info) => {
      if (info.status === "progress") {
        parentPort.postMessage({ type: "progress", info });
      }
    }
  });
}

parentPort.on("message", async (msg) => {
  if (msg.action !== "run") return;

  const { model, systemPrompt, messages, maxTokens, temperature } = msg.data;
  
  // Device strategy: 
  // We try GPU (dml) first but with limited parallel tasks to avoid crashes.
  // If it fails, CPU with ALL cores is very fast for small models like Qwen 0.8B.
  const devices = ["dml", "cpu"].filter(d => !blacklistedDevices.has(d));
  
  let success = false;
  let lastError = null;

  for (const device of devices) {
    try {
      if (!activePipeline || activeModelName !== model || activePipeline.device !== device) {
        activePipeline = null; 
        activePipeline = await getPipeline(model, device);
        activePipeline.device = device;
        activeModelName = model;
      }

      const chatMessages = [];
      if (systemPrompt) {
        chatMessages.push({ role: "system", content: systemPrompt });
      }
      for (const m of messages) {
        chatMessages.push({ role: m.role, content: m.content });
      }

      const streamer = new TextStreamer(activePipeline.tokenizer, {
        on_token_callback: (token) => {
          if (typeof token === "string" && token.length > 0) {
            parentPort.postMessage({ type: "token", token });
          }
        },
        skip_prompt: true,
        skip_special_tokens: true
      });

      // Optimization: use smaller chunks for generation to keep the system responsive
      const output = await activePipeline(chatMessages, {
        max_new_tokens: maxTokens,
        temperature: temperature,
        do_sample: temperature > 0,
        streamer: streamer,
        return_full_text: false,
        // Performance tweaks
        num_beams: 1,
        early_stopping: false
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
      success = true;
      break;

    } catch (error) {
      console.warn(`[Local AI Worker] Device ${device} failed, switching...`);
      blacklistedDevices.add(device);
      activePipeline = null;
      lastError = error;
    }
  }

  if (!success) {
    parentPort.postMessage({ type: "error", error: `Critical failure: ${lastError?.message}` });
  }
});
