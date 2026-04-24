import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const PARSER_SCRIPT = path.join(__dirname, "..", "python", "parser.py");

// Use 'python3' on Linux/Render, fall back to 'python' on Windows
const PYTHON_BIN = process.platform === "win32" ? "python" : "python3";

/**
 * Parse an Excel file using the Python parser.
 * Returns { columns: string[], rows: Record<string, any>[] }
 */
export function parseExcel(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.path) {
      return reject(new Error("No file provided to parser"));
    }

    console.log("Spawning Python with file:", file.path);
    const python = spawn(PYTHON_BIN, [PARSER_SCRIPT, file.path]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => { stdout += data.toString(); });
    python.stderr.on("data", (data) => {
      stderr += data.toString();
      console.error("stderr:", data.toString());
    });

    python.on("close", (code) => {
      console.log("Python process exited with code:", code);
      if (code !== 0) {
        return reject(new Error(`Parser exited with code ${code}: ${stderr}`));
      }
      try {
        const result = JSON.parse(stdout);
        if (!result.columns || !result.rows) {
          return reject(new Error("Invalid parser output: missing columns or rows"));
        }
        resolve(result);
      } catch (e) {
        reject(new Error(`Failed to parse Python output: ${e.message}`));
      }
    });

    python.on("error", (err) => {
      reject(new Error(`Failed to start Python process: ${err.message}`));
    });
  });
}
