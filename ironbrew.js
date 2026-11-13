const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static findTool() {
        const candidates = [
            { path: path.join(__dirname, "lua-deobfuscator-js", "index.js"), runner: "node", useCwd: true },
            { path: path.join(__dirname, "lua-deobfuscators", "IronBrew2Deobfuscator", "IronBrew2Deobfuscator.dll"), runner: "dotnet", useCwd: false },
            { path: path.join(__dirname, "lua-deobfuscators", "IronBrew2Deobfuscator", "IronBrew2Deobfuscator.exe"), runner: "mono", useCwd: false }
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate.path)) {
                return candidate;
            }
        }
        return { error: "No valid IronBrew tool found." };
    }
    
    static async run(inputFile) {
        const tool = this.findTool();
        if (tool.error) {
            return { error: tool.error, details: `لم يتم العثور على أداة صالحة.` };
        }
        
        return new Promise((resolve) => {
            let proc;
            try {
                const cwd = tool.useCwd ? path.dirname(inputFile) : __dirname;
                const args = tool.useCwd ? [tool.path] : [tool.path, inputFile];
                
                proc = spawn(tool.runner, args, { 
                    timeout: 120000, 
                    killSignal: 'SIGKILL',
                    cwd: cwd
                });
            } catch (spawnErr) {
                return resolve({ error: "Spawn failed", details: `فشل تشغيل الأداة: ${spawnErr.message}` });
            }
            
            let stdout = "", stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => resolve({ error: "Process error", details: err.message }));
            
            proc.on("close", (code, signal) => {
                if (signal === 'SIGKILL') {
                    return resolve({ error: "Timeout", details: `الأداة تجاوزت 120 ثانية.` });
                }
                if (code === 0 && stdout.length > 50) {
                    return resolve({ text: stdout });
                }
                
                // بعض الأدوات تحفظ النتيجة في ملف بدل الطباعة
                const outFile = path.join(path.dirname(inputFile), "output.lua");
                if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50) {
                    return resolve({ text: fs.readFileSync(outFile, "utf-8") });
                }
                
                resolve({ error: `Tool failed (exit code ${code})`, details: `STDERR:\n${stderr.slice(-800)}\nSTDOUT:\n${stdout.slice(-400)}` });
            });
        });
    }
}

module.exports = { IronBrewBridge };
