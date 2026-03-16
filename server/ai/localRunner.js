import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function callLocal({ model, systemPrompt, messages, onToken, onProgress, maxTokens = 2048, temperature = 0.7 }) {
  // Model name should be the HF repo name, e.g., "Qwen/Qwen3.5-0.8B"
  const hfModel = model.startsWith("local/") ? model.slice(6) : model;

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, "localWorker.js");
    const worker = new Worker(workerPath, {
      workerData: {
        model: hfModel,
        systemPrompt,
        messages,
        maxTokens,
        temperature
      }
    });

    worker.on("message", (msg) => {
      if (msg.type === "token") {
        if (typeof onToken === "function") {
          onToken(msg.token);
        }
      } else if (msg.type === "progress") {
        if (typeof onProgress === "function") {
          onProgress(msg.info);
        }
      } else if (msg.type === "done") {
        resolve({
          text: msg.text,
          usage: null,
          finishReason: "stop"
        });
        worker.terminate();
      } else if (msg.type === "error") {
        reject(new Error(msg.error));
        worker.terminate();
      }
    });

    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Worker stopped with exit code ${code}`));
      }
    });
  });
}
