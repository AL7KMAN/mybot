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
                    
                    // مسح تعليقات Prometheus الزايدة
                    text = text.replace(/^-- PHASE_BOUNDARY:INIT\s*/gm, '');
                    
                    // مسح أي أسطر فاضية ناتجة عن المسح
                    text = text.replace(/\n\s*\n/g, '\n');
                    
                    return resolve({ text: text });
                }

                resolve({ error: `Prometheus failed to generate output file.` });
            });
        });
    }
}

module.exports = { MoonsecBridge };
