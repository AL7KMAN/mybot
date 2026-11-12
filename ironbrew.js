const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static async run(inputFile) {
        return new Promise((resolve) => {
            const toolPath = path.join(__dirname, "lua-deobfuscators", "ironbrew", "main.py");
            
            if (!fs.existsSync(toolPath)) {
                return resolve({ error: "IronBrew tool not found. Check Dockerfile." });
            }

            const proc = spawn("python3", [toolPath, inputFile], { timeout: 120000, killSignal: 'SIGKILL' });
            let stdout = "", stderr = "";
            
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => resolve({ error: `spawn failed: ${err.message}` }));
            
            proc.on("close", (code) => {
                if (code === 0 && stdout.length > 50) {
                    resolve({ text: stdout });
                } else {
                    const outFile = inputFile + ".deobf.lua";
                    if (fs.existsSync(outFile)) {
                        resolve({ text: fs.readFileSync(outFile, "utf-8") });
                    } else {
                        resolve({ error: `IronBrew failed (Code ${code}): ${stderr.slice(-200)}` });
                    }
                }
            });
        });
    }
}

module.exports = { IronBrewBridge };
