const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                let safeCode = decompileResult.text;
                
                try { safeCode = MoonsecBridge.fixMojibake(safeCode); } catch (e) {}
                try { safeCode = MoonsecBridge.cleanArtifacts(safeCode); } catch (e) {}
                try { safeCode = MoonsecBridge.safeRenameEngine(safeCode); } catch (e) {}
                try { safeCode = MoonsecBridge.beautify(safeCode); } catch (e) {}

                return { text: safeCode, urls: MoonsecBridge.extractUrls(safeCode), decompiler: decompileResult.decompiler };
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
            return { text: rsResult.out, decompiler: "unluac-rs (Rust)" };
        }
        
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) {
            return { text: javaResult.out, decompiler: "unluac (Java)" };
        }
        
        return { isBytecode: true, error: `Rust: ${rsResult.error} | Java: ${javaResult.error}` };
    }

    static fixMojibake(str) {
        if (!str || typeof str !== 'string') return str;
        try {
            const win1256Bytes = new Uint8Array(str.length);
            let hasMojibake = false;

            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                if (code >= 0xC0 && code <= 0xFF) {
                    win1256Bytes[i] = code;
                    hasMojibake = true;
                } else if (code === 0xA4 || code === 0xA6 || code === 0xA8 || code === 0xAA) {
                    win1256Bytes[i] = code;
                    hasMojibake = true;
                } else {
                    win1256Bytes[i] = code & 0xFF;
                }
            }

            if (!hasMojibake) return str;

            const decoder = new TextDecoder('utf-8', { fatal: false });
            return decoder.decode(win1256Bytes);
        } catch (e) {
            return str;
        }
    }

    static cleanArtifacts(code) {
        let c = code;
        c = c.replace(/^-- file:.*$/gm, '');
        c = c.replace(/^-- dialect:.*$/gm, '');
        c = c.replace(/^-- encoding:.*$/gm, '');
        c = c.replace(/^-- decompiled by.*$/gm, '');
        c = c.replace(/ -- proto#\d+.*$/gm, '');
        c = c.replace(/-- PHASE_BOUNDARY:\w+\s*/g, '');
        c = c.replace(/-- \[\d+\]\s*/g, '');
        c = c.replace(/\[POL\] - /g, '-- ');
        c = c.replace(/\n{3,}/g, '\n\n');
        return c.trim();
    }

    static extractUrls(code) {
        const urls = code.match(/https?:\/\/[^\s"'`]+/g) || [];
        return [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
    }

    static safeRenameEngine(code) {
        let modified = code;
        const renameMap = new Map();
        const usedNames = new Set();

        const addRename = (oldName, newNameBase) => {
            if (!oldName || !newNameBase) return;
            if (renameMap.has(oldName)) return;
            if (!oldName.match(/^[a-zA-Z0-9_]+$/)) return;
            if (!oldName.match(/^[rp]\d+_\d+$/)) return;

            let finalName = newNameBase;
            let counter = 1;
            while (usedNames.has(finalName)) {
                finalName = newNameBase + "_" + counter++;
            }
            usedNames.add(finalName);
            renameMap.set(oldName, finalName);
        };

        const servRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+[:\.]GetService\s*\(\s*["']([^"']+)["']\s*\)/g;
        let match;
        while ((match = servRegex.exec(code)) !== null) {
            const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            addRename(match[1], clean + "_Service");
        }

        const instRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*Instance\.new\s*\(\s*["']([^"']+)["']/g;
        while ((match = instRegex.exec(code)) !== null) {
            const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            addRename(match[1], clean + "_Instance");
        }

        const lpRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\.LocalPlayer/g;
        while ((match = lpRegex.exec(code)) !== null) {
            addRename(match[1], "LocalPlayer");
        }

        const sortedKeys = Array.from(renameMap.keys()).sort((a, b) => b.length - a.length);
        for (const oldName of sortedKeys) {
            const newName = renameMap.get(oldName);
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modified = modified.replace(regex, newName);
        }

        return modified;
    }

    static beautify(code) {
        const lines = code.split('\n');
        let indent = 0;
        const result = [];
        
        for (let line of lines) {
            let trimmed = line.trim();
            if (!trimmed) continue;
            
            if (/^(end|else|elseif|until|\})/i.test(trimmed)) {
                indent = Math.max(0, indent - 1);
            }
            
            result.push("    ".repeat(indent) + trimmed);
            
            if (/(then|do|function|repeat|else|elseif|\{)$/i.test(trimmed) && !/^(else|elseif)/i.test(trimmed)) {
                indent++;
            }
        }
        
        return result.join('\n');
    }
    
    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let chunks = [];
                let err = "";
                
                proc.stdout.on("data", (data) => { chunks.push(data); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                
                proc.on("error", (e) => resolve({ success: false, out: "", error: e.message }));
                proc.on("close", (code) => {
                    const outStr = Buffer.concat(chunks).toString('binary');
                    if (code === 0 && outStr.length > 50) {
                        resolve({ success: true, out: outStr, error: null });
                    } else {
                        resolve({ success: false, out: outStr, error: err.slice(-500) || `Exit code ${code}` });
                    }
                });
            } catch (e) {
                resolve({ success: false, out: "", error: e.message });
            }
        });
    }
}

module.exports = { MoonsecBridge };
