const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static findTool() {
        const base = path.join(__dirname, "lua-deobfuscators");
        if (!fs.existsSync(base)) {
            return { error: "Base directory not found", details: `المسار المتوقع: ${base}\nالمجلد غير موجود.` };
        }
        const ironbrewDir = path.join(base, "IronBrew2Deobfuscator");
        if (!fs.existsSync(ironbrewDir)) {
            return { error: "IronBrew2Deobfuscator folder not found", details: `المجلد موجود، لكن لا يحتوي على مجلد IronBrew2Deobfuscator.` };
        }
        try {
            const allFiles = execSync(`find ${ironbrewDir} -maxdepth 3 -type f 2>/dev/null | head -50`, { encoding: 'utf-8' }).trim();
            const dirListing = execSync(`ls -laR ${ironbrewDir} 2>/dev/null | head -100`, { encoding: 'utf-8' }).trim();
            const potentialScripts = [];
            
            const pyFiles = execSync(`find ${ironbrewDir} -name "*.py" -type f 2>/dev/null`, { encoding: 'utf-8' }).trim();
            if (pyFiles) potentialScripts.push({ type: 'python', files: pyFiles.split('\n') });
            
            const jsFiles = execSync(`find ${ironbrewDir} -name "*.js" -type f 2>/dev/null | head -5`, { encoding: 'utf-8' }).trim();
            if (jsFiles) potentialScripts.push({ type: 'node', files: jsFiles.split('\n') });
            
            const exeFiles = execSync(`find ${ironbrewDir} -name "*.exe" -o -name "*.dll" 2>/dev/null | head -5`, { encoding: 'utf-8' }).trim();
            if (exeFiles) potentialScripts.push({ type: 'dotnet', files: exeFiles.split('\n') });
            
            if (potentialScripts.find(p => p.type === 'python') && potentialScripts.find(p => p.type === 'python').files.length > 0) {
                return { path: potentialScripts.find(p => p.type === 'python').files[0], runner: 'python3' };
            }
            if (potentialScripts.find(p => p.type === 'node') && potentialScripts.find(p => p.type === 'node').files.length > 0) {
                return { path: potentialScripts.find(p => p.type === 'node').files[0], runner: 'node' };
            }
            return { error: "No recognized script found in IronBrew2Deobfuscator", details: `المجلد موجود لكن لم نجد ملفات .py أو .js واضحة.\n\n📁 محتويات المجلد:\n${dirListing || "(فارغ)"}` };
        } catch (e) {
            return { error: "Tool discovery failed", details: `فشل البحث: ${e.message}` };
        }
    }
    
    static async run(inputFile) {
        const tool = this.findTool();
        if (tool.error) {
            return { error: tool.error, details: tool.details };
        }
        return new Promise((resolve) => {
            let proc;
            try {
                proc = spawn(tool.runner, [tool.path, inputFile], { timeout: 60000, killSignal: 'SIGKILL' });
            } catch (spawnErr) {
                return resolve({ error: "Spawn failed", details: `فشل تشغيل الأداة: ${spawnErr.message}\nالمسار: ${tool.path}` });
            }
            let stdout = "", stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("error", (err) => resolve({ error: "Process error", details: `خطأ في العملية: ${err.message}` }));
            proc.on("close", (code, signal) => {
                if (signal === 'SIGKILL') {
                    return resolve({ error: "Timeout", details: `الأداة تجاوزت 60 ثانية.\nالمسار: ${tool.path}` });
                }
                const outFile = inputFile + ".deobf.lua";
                if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50) {
                    return resolve({ text: fs.readFileSync(outFile, "utf-8") });
                }
                if (code === 0 && stdout.length > 50) {
                    return resolve({ text: stdout });
                }
                resolve({ error: `Tool failed (exit code ${code})`, details: `المسار: ${tool.path}\nالمشغل: ${tool.runner}\n\n📋 STDERR:\n${stderr.slice(-800) || "(فارغ)"}\n\n📤 STDOUT:\n${stdout.slice(-400) || "(فارغ)"}` });
            });
        });
    }
}

module.exports = { IronBrewBridge };
