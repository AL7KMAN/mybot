const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                try {
                    decompileResult.text = MoonsecBridge.inferVariableNames(decompileResult.text);
                    decompileResult.text = MoonsecBridge.fixEncoding(decompileResult.text, dllResult.luacFile);
                } catch (e) {}
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
        
        const urls = finalCode.match(/https?:\/\/[^\s"'`]+/g) || [];
        const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
        
        return { text: finalCode, urls: uniqueUrls, decompiler: source };
    }

    static fixEncoding(code, luacPath) {
        let fixedCode = code;
        try {
            const buf = fs.readFileSync(luacPath);
            let offset = 12;
            
            const readInt = () => { const v = buf.readInt32LE(offset); offset += 4; return v; };
            const readByte = () => { return buf[offset++]; };
            const readString = () => {
                const size = readInt();
                if (size === 0) return null;
                const str = buf.subarray(offset, offset + size - 1).toString('binary');
                offset += size;
                return str;
            };

            const strings = [];
            const parseFunction = () => {
                readString();
                readInt();
                readInt();
                readByte();
                readByte();
                readByte();
                readByte();
                
                const sizecode = readInt();
                offset += sizecode * 4;
                
                const sizek = readInt();
                for (let i = 0; i < sizek; i++) {
                    const type = readByte();
                    if (type === 4) {
                        const s = readString();
                        if (s) strings.push(s);
                    } else if (type === 3) {
                        offset += 8;
                    } else if (type === 1) {
                        offset += 1;
                    }
                }
                
                const sizep = readInt();
                for (let i = 0; i < sizep; i++) {
                    parseFunction();
                }
                
                const sizelineinfo = readInt();
                offset += sizelineinfo * 4;
                
                const sizelocvars = readInt();
                for (let i = 0; i < sizelocvars; i++) {
                    readString();
                    readInt();
                    readInt();
                }
                
                const sizeupvalues = readInt();
                for (let i = 0; i < sizeupvalues; i++) {
                    readString();
                }
            };
            
            parseFunction();

            for (const rawBinary of strings) {
                const rawBuf = Buffer.from(rawBinary, 'binary');
                const decoded = new TextDecoder('windows-1256').decode(rawBuf);
                
                if (/[\u0600-\u06FF]/.test(decoded) && decoded.length > 1) {
                    const rest = decoded.substring(1);
                    const corrupted1 = '\uFFFD' + rest;
                    const corrupted2 = 'ï؟½' + rest;
                    
                    if (fixedCode.includes(corrupted1)) {
                        fixedCode = fixedCode.split(corrupted1).join(decoded);
                    }
                    if (fixedCode.includes(corrupted2)) {
                        fixedCode = fixedCode.split(corrupted2).join(decoded);
                    }
                }
            }
        } catch (e) {}
        
        return fixedCode;
    }

    static inferVariableNames(code) {
        let modified = code;
        const map = new Map();

        const servRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[:\.]GetService\s*\(\s*["']([^"']+)["']\s*\)/g;
        let match;
        while ((match = servRegex.exec(code)) !== null) {
            const cleanName = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            const newName = cleanName + "_Service";
            if (!Array.from(map.values()).includes(newName)) {
                map.set(match[1], newName);
            }
        }

        const instRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[\.\:]new\s*\(\s*["']([^"']+)["']/g;
        while ((match = instRegex.exec(code)) !== null) {
            const cleanName = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            const newName = cleanName + "_Inst";
            if (!Array.from(map.values()).includes(newName)) {
                map.set(match[1], newName);
            }
        }

        const lpRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.LocalPlayer/g;
        while ((match = lpRegex.exec(code)) !== null) {
            const newName = "LocalPlayer";
            if (!Array.from(map.values()).includes(newName)) {
                map.set(match[1], newName);
            }
        }

        const sortedKeys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
        for (const oldName of sortedKeys) {
            const newName = map.get(oldName);
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modified = modified.replace(regex, newName);
        }

        return modified;
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
