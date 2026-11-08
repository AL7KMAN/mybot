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
                    let text = fs.readFileSync(fullPath, "utf-8");
                    
                    text = text.replace(/-- PHASE_BOUNDARY:[A-Z]+\s*/g, '');
                    text = text.replace(/-- \[\d+\]\s*/g, '');
                    text = text.replace(/\[POL\] - /g, '-- ');
                    text = text.replace(/local function =/g, 'local _func =');
                    text = text.replace(/local element = ;/g, 'local element = 0;');
                    text = text.replace(/local element =  ;/g, 'local element = 0;');
                    text = text.replace(/\n{3,}/g, '\n\n');

                    const urls = text.match(/https?:\/\/[^\s"'`]+/g) || [];
                    const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);

                    return resolve({ text: text, urls: uniqueUrls });
                }

                resolve({ error: `Prometheus failed to generate output file.` });
            });
        });
    }
}

module.exports = { MoonsecBridge };
