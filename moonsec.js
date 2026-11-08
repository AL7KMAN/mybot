const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { 
                timeout: 60000, 
                killSignal: 'SIGKILL' 
            });
            
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                resolve({ error: `Moonsec DLL spawn failed: ${err.message}` });
            });

            proc.on("close", (code) => {
                if (code !== 0 || !fs.existsSync(luacFile) || fs.statSync(luacFile).size < 10) {
                    return resolve({ error: `Moonsec DLL exit ${code}: ${stderr.slice(-300)}` });
                }
                MoonsecBridge.tryDecompress(luacFile).then(resolve);
            });
        });
    }
    
    static async tryDecompress(luacFile) {
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, [luacFile], 60000);
        if (rsResult && rsResult.length > 50) {
            return MoonsecBridge.formatOutput(rsResult, "unluac-rs (Rust)");
        }
        
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult && javaResult.length > 50) {
            return MoonsecBridge.formatOutput(javaResult, "unluac (Java)");
        }
        
        const luacData = fs.readFileSync(luacFile);
        return { isBytecode: true, buffer: luacData };
    }
    
    static formatOutput(code, source) {
        let finalCode = code;
        finalCode = finalCode.replace(/-- PHASE_BOUNDARY:\w+\s*/g, '');
        finalCode = finalCode.replace(/-- \[\d+\]\s*/g, '');
        finalCode = finalCode.replace(/\[POL\] - /g, '-- ');
        finalCode = finalCode.replace(/\n{3,}/g, '\n\n');
        
        const urls = finalCode.match(/https?:\/\/[^\s"'`]+/g) || [];
        const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
        
        return { text: finalCode, urls: uniqueUrls, decompiler: source };
    }
    
    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let out = "";
                let err = "";
                proc.stdout.on("data", (data) => { out += data.toString(); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                
                proc.on("error", () => resolve(null));
                proc.on("close", (code) => {
                    if (code === 0 && out.length > 50 && !err.includes("Implicit return")) {
                        resolve(out);
                    } else {
                        resolve(null);
                    }
                });
            } catch (e) {
                resolve(null);
            }
        });
    }
}

module.exports = { MoonsecBridge };
