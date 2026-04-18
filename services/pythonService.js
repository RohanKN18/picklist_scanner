import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PARSER_SCRIPT = path.join(__dirname, "..", "python", "parser.py");

/**
 * Parse an Excel file using the Python microservice.
 * Returns { columns: string[], rows: Record<string, any>[] }
 */
export function parseExcel(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.path) {
      return reject(new Error("No file provided to parser"));
    }

    console.log("Spawning Python with file:", file.path);
    const python = spawn("C:\\Python312\\python.exe", [PARSER_SCRIPT, file.path]);

    let stdout = "";
    let stderr = "";

    python.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    python.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    python.on("close", (code) => {
      console.log("Python process exited with code:", code);
      console.log("stdout:", stdout);
      console.log("stderr:", stderr);
      if (code !== 0) {
        console.error("Python stderr:", stderr);
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
