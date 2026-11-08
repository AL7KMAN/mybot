
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve) => {
            const polPath = path.join(__dirname, "tools/prometheus/pol.py");

            const proc = spawn("/opt/venv/bin/python3", [polPath, inputFile], { 
                timeout: 180000, 
                killSignal: 'SIGKILL' 
            });
            
            let stdout = "", stderr = "";
            proc.stdout.on("data", (d) => { stdout += d.toString(); });
            proc.stderr.on("data", (d) => { stderr += d.toString(); });
            
            proc.on("error", (err) => {
                resolve({ error: `Failed to start Prometheus: ${err.message}` });
            });

            proc.on("close", (code) => {
                const dir = path.dirname(inputFile);
                let deobfFile = null;
                try {
                    const files = fs.readdirSync(dir);
                    deobfFile = files.find(f => f.endsWith(".lua") && f !== "input.lua");
                } catch (e) {}

                if (deobfFile) {
                    const fullPath = path.join(dir, deobfFile);
                    const text = fs.readFileSync(fullPath, "utf-8");
                    return resolve({ text: text });
                }

                if (stdout.length > 50 && !stdout.includes("[POL]")) {
                    return resolve({ text: stdout });
                }

                resolve({ error: `Prometheus failed to generate output file.` });
            });
        });
    }
}

module.exports = { MoonsecBridge };ض
