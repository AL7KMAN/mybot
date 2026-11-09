const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                return decompileResult;
            }
            return { error: `Pipeline failed. Reason: ${decompileResult.error}` };
        }
        
        return { error: `DLL failed: ${dllResult.error}` };
    }
    
    static async tryDll(inputFile) {
        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { 
                timeout: 180000, 
                killSignal: 'SIGKILL' 
            });
            
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                resolve({ success: false, error: `spawn failed: ${err.message}` });
            });

            proc.on("close", (code, signal) => {
                if (fs.existsSync(luacFile) && fs.statSync(luacFile).size > 10) {
                    return resolve({ success: true, luacFile });
                }
                if (signal === "SIGKILL") {
                    return resolve({ success: false, error: `DLL killed by timeout after 180s. ${stderr.slice(-200)}` });
                }
                resolve({ success: false, error: `DLL exit ${code}: ${stderr.slice(-300)}` });
            });
        });
    }

    static async tryDecompress(luacFile) {
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, ["-i", luacFile], 60000);
        if (rsResult.success && rsResult.out.length > 50) {
            return MoonsecBridge.formatOutput(rsResult.out, "unluac-rs (Rust)");
        }
        
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) {
            return MoonsecBridge.formatOutput(javaResult.out, "unluac (Java)");
        }
        
        const errorMsg = `Rust: ${rsResult.error} | Java: ${javaResult.error}`;
        return { isBytecode: true, error: errorMsg };
    }
    
    static extractStrings(code) {
        const strings = new Set();
        const regex = /["']((?:(?!\1).)*)\1/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const str = match[1];
            if (str.length > 2 && !str.includes('\n') && !str.includes('\\')) {
                strings.add(str);
            }
        }
        if (strings.size > 0) {
            const stringList = Array.from(strings).map(s => `print("${s}")`).join('\n');
            return `-- Extracted Strings --\n${stringList}\n\n`;
        }
        return "";
    }
    
    static formatOutput(code, source) {
        let finalCode = code;
        
        finalCode = finalCode.replace(/^-- file:.*$/gm, '');
        finalCode = finalCode.replace(/^-- dialect:.*$/gm, '');
        finalCode = finalCode.replace(/^-- encoding:.*$/gm, '');
        finalCode = finalCode.replace(/^-- decompiled by.*$/gm, '');
        finalCode = finalCode.replace(/ -- proto#\d+.*$/gm, '');
        finalCode = finalCode.replace(/-- PHASE_BOUNDARY:\w+\s*/g, '');
        finalCode = finalCode.replace(/-- \[\d+\]\s*/g, '');
        finalCode = finalCode.replace(/\[POL\] - /g, '-- ');
        finalCode = finalCode.replace(/\n{3,}/g, '\n\n');
        finalCode = finalCode.trim();
        
        const extractedStrings = MoonsecBridge.extractStrings(finalCode);
        finalCode = extractedStrings + finalCode;
        
        const urls = finalCode.match(/https?:\/\/[^\s"'`]+/g) || [];
        const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
        
        return { text: finalCode, urls: uniqueUrls, decompiler: source };
    }
    
    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let out = "", err = "";
                proc.stdout.on("data", (data) => { out += data.toString(); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                
                proc.on("error", (e) => resolve({ success: false, out: "", error: e.message }));
                proc.on("close", (code) => {
                    if (code === 0 && out.length > 50) {
                        resolve({ success: true, out: out, error: null });
                    } else {
                        resolve({ success: false, out: out, error: err.slice(-500) || `Exit code ${code}` });
                    }
                });
            } catch (e) {
                resolve({ success: false, out: "", error: e.message });
            }
        });
    }
}

module.exports = { MoonsecBridge };
