const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static findTool() {
        const csPath = path.join(__dirname, "ironbrew-bin", "IronbrewDeobfuscator.dll");
        if (fs.existsSync(csPath)) {
            return { type: "csharp", path: csPath, runner: "dotnet" };
        }

        const jsPath = path.join(__dirname, "lua-deobfuscator-js", "index.js");
        if (fs.existsSync(jsPath)) {
            return { type: "nodejs", path: jsPath, runner: "node" };
        }

        const pyPath = path.join(__dirname, "lua-deobfuscators", "IronBrew2Deobfuscator", "main.py");
        if (fs.existsSync(pyPath)) {
            return { type: "python", path: pyPath, runner: "python3" };
        }

        return { error: "No IronBrew tool found." };
    }
    
    static async run(inputFile) {
        const tool = this.findTool();
        if (tool.error) {
            return { error: tool.error, details: "لم يتم العثور على أي أداة لـ IronBrew." };
        }
        
        return new Promise((resolve) => {
            let proc;
            
            if (tool.type === "csharp") {
                const outputFile = inputFile + ".luac";
                const args = [tool.path, "-t", "ib2", "-f", inputFile, "-o", outputFile, "--enable-maxcflow"];
                proc = spawn(tool.runner, args, { timeout: 180000, killSignal: 'SIGKILL' });
            } else if (tool.type === "nodejs") {
                const toolDir = path.dirname(tool.path);
                const toolInput = path.join(toolDir, "input.lua");
                const toolOutput = path.join(toolDir, "output.lua");
                
                fs.copyFileSync(inputFile, toolInput);
                if (fs.existsSync(toolOutput)) fs.unlinkSync(toolOutput);
                
                proc = spawn(tool.runner, [tool.path], { timeout: 120000, killSignal: 'SIGKILL', cwd: toolDir });
            } else {
                proc = spawn(tool.runner, [tool.path, inputFile], { timeout: 120000, killSignal: 'SIGKILL' });
            }
            
            let stdout = "", stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => resolve({ error: "Process error", details: err.message }));
            
            proc.on("close", (code, signal) => {
                if (signal === 'SIGKILL') {
                    return resolve({ error: "Timeout", details: `الأداة (${tool.type}) تجاوزت الوقت المحدد.` });
                }
                
                if (tool.type === "csharp") {
                    const outputFile = inputFile + ".luac";
                    if (fs.existsSync(outputFile) && fs.statSync(outputFile).size > 50) {
                        return resolve({ text: `-- Decompiled via C# IronBrew2Deobfuscator\n-- Bytecode saved to .luac, use unluac to decompile\n-- (Bytecode hex below)\n\n${fs.readFileSync(outputFile).toString('hex')}` });
                    }
                } else if (tool.type === "nodejs") {
                    const toolDir = path.dirname(tool.path);
                    const toolOutput = path.join(toolDir, "output.lua");
                    if (fs.existsSync(toolOutput) && fs.statSync(toolOutput).size > 50) {
                        const out = fs.readFileSync(toolOutput, "utf-8");
                        try { fs.unlinkSync(toolOutput); } catch (e) {}
                        return resolve({ text: out });
                    }
                }
                
                if (code === 0 && stdout.length > 100) {
                    return resolve({ text: stdout });
                }
                
                resolve({ error: `Tool failed (exit code ${code})`, details: `Type: ${tool.type}\nSTDERR:\n${stderr.slice(-800)}\nSTDOUT:\n${stdout.slice(-400)}` });
            });
        });
    }
}

module.exports = { IronBrewBridge };
