const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static async run(inputFile) {
        const toolDir = path.join(__dirname, "lua-deobfuscator-js");
        const toolEntry = path.join(toolDir, "index.js");
        
        if (!fs.existsSync(toolEntry)) {
            return { error: "Tool not found", details: `المسار المتوقع: ${toolEntry}` };
        }
        
        const toolInput = path.join(toolDir, "input.lua");
        const toolOutput = path.join(toolDir, "output.lua");
        
        fs.copyFileSync(inputFile, toolInput);
        if (fs.existsSync(toolOutput)) fs.unlinkSync(toolOutput);
        
        return new Promise((resolve) => {
            let proc;
            try {
                proc = spawn("node", [toolEntry], { 
                    timeout: 120000, 
                    killSignal: 'SIGKILL',
                    cwd: toolDir
                });
            } catch (spawnErr) {
                try { fs.unlinkSync(toolInput); } catch (e) {}
                return resolve({ error: "Spawn failed", details: spawnErr.message });
            }
            
            let stdout = "", stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                try { fs.unlinkSync(toolInput); } catch (e) {}
                resolve({ error: "Process error", details: err.message });
            });
            
            proc.on("close", (code, signal) => {
                let outputText = null;
                
                if (fs.existsSync(toolOutput) && fs.statSync(toolOutput).size > 50) {
                    outputText = fs.readFileSync(toolOutput, "utf-8");
                    try { fs.unlinkSync(toolOutput); } catch (e) {}
                } else if (stdout.length > 100 && !stdout.includes("Error")) {
                    outputText = stdout;
                }
                
                try { fs.unlinkSync(toolInput); } catch (e) {}
                
                if (outputText) {
                    return resolve({ text: outputText });
                }
                
                resolve({ 
                    error: `Tool failed (exit code ${code})`, 
                    details: `STDERR:\n${stderr.slice(-800)}\nSTDOUT:\n${stdout.slice(-400)}` 
                });
            });
        });
    }
}

module.exports = { IronBrewBridge };
