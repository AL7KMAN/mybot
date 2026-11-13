const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

class IronBrewBridge {
    static findTool() {
        const base = path.join(__dirname, "lua-deobfuscators");
        
        if (!fs.existsSync(base)) {
            return { 
                error: "Base directory not found",
                details: `المسار المتوقع: ${base}\nالمجلد غير موجود. تأكد من Dockerfile.`
            };
        }
        
        const candidates = [
            path.join(base, "ironbrew", "main.py"),
            path.join(base, "ironbrew", "ironbrew.py"),
            path.join(base, "ironbrew", "deobfuscate.py"),
            path.join(base, "ironbrew", "src", "main.py"),
            path.join(base, "ironbrew.py"),
            path.join(base, "ironbrew2", "main.py"),
            path.join(base, "IronBrew2", "main.py"),
            path.join(base, "IronBrew", "main.py"),
        ];
        
        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return { path: candidate };
            }
        }
        
        try {
            const listing = execSync(`find ${base} -name "*.py" -type f 2>/dev/null | head -30`, { encoding: 'utf-8' }).trim();
            const dirListing = execSync(`ls -la ${base} 2>/dev/null`, { encoding: 'utf-8' }).trim();
            
            return {
                error: "Tool path not found",
                details: `المسارات المتوقعة غير موجودة.\n\n📁 محتوى المجلد الأساسي:\n${dirListing || "(فارغ)"}\n\n📄 ملفات .py الموجودة:\n${listing || "(لا يوجد)"}`
            };
        } catch (e) {
            return {
                error: "Tool discovery failed",
                details: `فشل البحث: ${e.message}`
            };
        }
    }
    
    static async run(inputFile) {
        const tool = this.findTool();
        if (tool.error) {
            return { 
                error: tool.error, 
                details: tool.details 
            };
        }
        
        return new Promise((resolve) => {
            let proc;
            try {
                proc = spawn("python3", [tool.path, inputFile], { timeout: 60000, killSignal: 'SIGKILL' });
            } catch (spawnErr) {
                return resolve({ 
                    error: "Spawn failed", 
                    details: `فشل تشغيل الأداة: ${spawnErr.message}\nالمسار: ${tool.path}` 
                });
            }
            
            let stdout = "", stderr = "";
            
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                resolve({ 
                    error: "Process error", 
                    details: `خطأ في العملية: ${err.message}` 
                });
            });
            
            proc.on("close", (code, signal) => {
                if (signal === 'SIGKILL') {
                    return resolve({ 
                        error: "Timeout", 
                        details: `الأداة تجاوزت 60 ثانية بدون نتيجة.\nالمسار: ${tool.path}` 
                    });
                }
                
                const outFile = inputFile + ".deobf.lua";
                if (fs.existsSync(outFile) && fs.statSync(outFile).size > 50) {
                    return resolve({ text: fs.readFileSync(outFile, "utf-8") });
                }
                
                if (code === 0 && stdout.length > 50) {
                    return resolve({ text: stdout });
                }
                
                resolve({
                    error: `Tool failed (exit code ${code})`,
                    details: `المسار المستخدم: ${tool.path}\n\n📋 STDERR (آخر 800 حرف):\n${stderr.slice(-800) || "(فارغ)"}\n\n📤 STDOUT (آخر 400 حرف):\n${stdout.slice(-400) || "(فارغ)"}`
                });
            });
        });
    }
}

module.exports = { IronBrewBridge };
