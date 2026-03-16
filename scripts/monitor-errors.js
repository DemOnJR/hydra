import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import os from 'node:os';

// Minimal implementation of runtime paths logic to find the DB
const APP_DIR_NAME = "Hydra";
function getHydraHome() {
  switch (process.platform) {
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
        APP_DIR_NAME
      );
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support", APP_DIR_NAME);
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), APP_DIR_NAME.toLowerCase());
  }
}

const dbPath = path.join(getHydraHome(), "data", "hydra.db");
const errorsFile = path.join(process.cwd(), "APP-ERRORS.md");

function monitor() {
  console.log(`[Monitor] Checking for errors in ${dbPath}...`);
  
  if (!fs.existsSync(dbPath)) {
    console.warn(`[Monitor] DB not found at ${dbPath}`);
    return;
  }

  const db = new Database(dbPath, { readonly: true });
  
  try {
    const errors = db.prepare(`
      SELECT l.*, s.project_id, p.name as project_name
      FROM session_logs l
      JOIN orchestrator_sessions s ON s.id = l.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE l.level = 'error'
      ORDER BY l.created_at DESC
      LIMIT 50
    `).all();

    if (errors.length === 0) {
      console.log("[Monitor] No errors found.");
      return;
    }

    let existingContent = "";
    if (fs.existsSync(errorsFile)) {
      existingContent = fs.readFileSync(errorsFile, 'utf8');
    } else {
      existingContent = "# Application Errors Log\n\nThis file is automatically updated by the monitor script.\n\n";
    }

    let newEntries = "";
    for (const err of errors) {
      const entryId = `ID: ${err.id} | ${err.created_at}`;
      if (existingContent.includes(entryId)) continue;

      newEntries += `## Error ${err.id} - ${err.created_at}\n`;
      newEntries += `- **Project**: ${err.project_name} (${err.project_id})\n`;
      newEntries += `- **Session**: ${err.session_id}\n`;
      newEntries += `- **Message**: ${err.message}\n`;
      if (err.data) {
        newEntries += `- **Data**: \`${err.data}\`\n`;
      }
      newEntries += `\n---\n\n`;
    }

    if (newEntries) {
      fs.writeFileSync(errorsFile, existingContent + newEntries);
      console.log(`[Monitor] Added new errors to ${errorsFile}`);
    } else {
      console.log("[Monitor] No new errors to add.");
    }

  } catch (err) {
    console.error(`[Monitor] Error: ${err.message}`);
  } finally {
    db.close();
  }
}

// Run once and exit (can be scheduled via cron or called by the agent)
monitor();
