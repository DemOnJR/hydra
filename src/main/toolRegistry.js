import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tools = new Map();

/**
 * Register a tool.
 * @param {object} tool - The tool definition and handler.
 */
export function registerTool(tool) {
  if (!tool.name) {
    throw new Error("Tool must have a name.");
  }
  tools.set(tool.name, tool);
  console.info(`[Tools] Registered tool: ${tool.name}`);
}

/**
 * Get a tool by name.
 * @param {string} name - The tool name.
 * @returns {object|null}
 */
export function getTool(name) {
  return tools.get(name);
}

/**
 * Get all registered tools.
 * @returns {Array}
 */
export function getAllTools() {
  return Array.from(tools.values());
}

/**
 * Auto-discover and register tools from the plugins directory.
 */
export async function discoverTools() {
  const pluginsDir = path.join(__dirname, "plugins");
  
  if (!fs.existsSync(pluginsDir)) {
    fs.mkdirSync(pluginsDir, { recursive: true });
    return;
  }

  const files = fs.readdirSync(pluginsDir);
  
  for (const file of files) {
    if (file.endsWith(".js")) {
      try {
        const modulePath = path.join(pluginsDir, file);
        // Using file:// URL for dynamic import on Windows
        const toolModule = await import(`file://${modulePath}`);
        const toolsToRegister = toolModule.default || toolModule.tool || toolModule.tools;
        
        if (Array.isArray(toolsToRegister)) {
          toolsToRegister.forEach(registerTool);
        } else if (toolsToRegister) {
          registerTool(toolsToRegister);
        }
      } catch (error) {
        console.error(`[Tools] Failed to load tool from ${file}:`, error);
      }
    }
  }
}
