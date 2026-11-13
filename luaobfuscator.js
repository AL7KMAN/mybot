const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class LuaObfuscatorBridge {
    static async run(inputFile) {
        const toolDir = path.join(__dirname, "lua-deobfuscators", "luaobfuscator");
        const cliPath = path.join(toolDir, "src", "cli.js");
        
        if (!fs.existsSync(cliPath)) {
            return { error: "LuaObfuscator tool not found", details: `المسار المتوقع: ${cliPath}` };
        }

        return new Promise((resolve) => {
            let proc;
            try {
                proc = spawn("node", [cliPath, inputFile, "--stdout"], { 
                    timeout: 120000, 
                    killSignal: 'SIGKILL',
                    cwd: toolDir
                });
            } catch (spawnErr) {
                return resolve({ error: "Spawn failed", details: spawnErr.message });
            }
            
            let stdout = "", stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => resolve({ error: "Process error", details: err.message }));
            
            proc.on("close", (code, signal) => {
                if (signal === 'SIGKILL') {
                    return resolve({ error: "Timeout", details: "الأداة تجاوزت 120 ثانية." });
                }
                if (code === 0 && stdout.length > 50) {
                    return resolve({ text: stdout });
                }
                
                resolve({ 
                    error: `LuaObfuscator failed (exit code ${code})`, 
                    details: `STDERR:\n${stderr.slice(-800)}\nSTDOUT:\n${stdout.slice(-400)}` 
                });
            });
        });
    }
}

module.exports = { LuaObfuscatorBridge };
