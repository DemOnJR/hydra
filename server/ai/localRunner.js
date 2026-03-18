import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let activeWorker = null;
let currentModel = null;
let pendingRequest = null;

function getWorker(model) {
  if (activeWorker && currentModel === model) {
    return activeWorker;
  }

  if (activeWorker) {
    activeWorker.terminate();
  }

  const workerPath = path.join(__dirname, "localWorker.js");
  activeWorker = new Worker(workerPath);
  currentModel = model;
  
  activeWorker.on("error", (err) => {
    console.error("[Local AI Worker] Critical error:", err);
    if (pendingRequest) {
      pendingRequest.reject(err);
      pendingRequest = null;
    }
    activeWorker = null;
    currentModel = null;
  });

  activeWorker.on("exit", (code) => {
    if (code !== 0 && pendingRequest) {
      pendingRequest.reject(new Error(`Worker stopped with exit code ${code}`));
      pendingRequest = null;
    }
    activeWorker = null;
    currentModel = null;
  });

  return activeWorker;
}

export async function callLocal({ model, systemPrompt, messages, onToken, onProgress, maxTokens = 2048, temperature = 0.7 }) {
  const hfModel = model.startsWith("local/") ? model.slice(6) : model;
  const worker = getWorker(hfModel);

  return new Promise((resolve, reject) => {
    // If there's already a request, we could queue it, but for now just reject
    if (pendingRequest) {
      reject(new Error("Another local AI request is already in progress."));
      return;
    }

    pendingRequest = { resolve, reject, onToken, onProgress };

    const messageHandler = (msg) => {
      if (msg.type === "token") {
        if (typeof onToken === "function") {
          onToken(msg.token);
        }
      } else if (msg.type === "progress") {
        if (typeof onProgress === "function") {
          onProgress(msg.info);
        }
      } else if (msg.type === "done") {
        worker.off("message", messageHandler);
        resolve({
          text: msg.text,
          usage: null,
          finishReason: "stop"
        });
        pendingRequest = null;
      } else if (msg.type === "error") {
        worker.off("message", messageHandler);
        reject(new Error(msg.error));
        pendingRequest = null;
      }
    };

    worker.on("message", messageHandler);

    worker.postMessage({
      action: "run",
      data: {
        model: hfModel,
        systemPrompt,
        messages,
        maxTokens,
        temperature
      }
    });
  });
}
