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
                let targetFile = null;
                
                try {
                    const files = fs.readdirSync(dir);
                    const possibleFiles = ["output.lua", "deobfuscated.lua", "output_cleaned.lua", "pol_output.lua"];
                    for (const f of possibleFiles) {
                        if (files.includes(f)) {
                            targetFile = path.join(dir, f);
                            break;
                        }
                    }
                    
                    if (!targetFile) {
                        const anyLua = files.find(f => f.endsWith(".lua") && f !== "input.lua");
                        if (anyLua) targetFile = path.join(dir, anyLua);
                    }
                } catch (e) {}

                if (targetFile && fs.existsSync(targetFile)) {
                    const text = fs.readFileSync(targetFile, "utf-8");
                    return resolve({ text: text });
                }

                if (stdout.length > 50) {
                    return resolve({ text: stdout });
                }

                resolve({ error: `Prometheus finished but no output file was found.` });
            });
        });
    }
}

module.exports = { MoonsecBridge };
