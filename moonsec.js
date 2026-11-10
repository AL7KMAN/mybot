const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                let code = decompileResult.text;
                try { code = MoonsecBridge.fixArabic(code); } catch (e) {}
                try { code = MoonsecBridge.cleanArtifacts(code); } catch (e) {}
                try { code = MoonsecBridge.renameVariables(code); } catch (e) {}
                try { code = MoonsecBridge.beautify(code); } catch (e) {}
                return { text: code, urls: MoonsecBridge.extractUrls(code), decompiler: decompileResult.decompiler };
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
            proc.on("error", (err) => resolve({ success: false, error: `spawn failed: ${err.message}` }));
            proc.on("close", (code, signal) => {
                if (fs.existsSync(luacFile) && fs.statSync(luacFile).size > 10) {
                    return resolve({ success: true, luacFile });
                }
                if (signal === "SIGKILL") {
                    return resolve({ success: false, error: `DLL killed by timeout.` });
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

    static fixArabic(code) {
        if (!code) return code;
        try {
            const decoder = new TextDecoder('windows-1256');
            const reverseMap = {};
            for (let i = 0; i < 256; i++) {
                const char = decoder.decode(new Uint8Array([i]));
                if (char.length === 1) reverseMap[char] = i;
            }
            
            return code.replace(/(["'])(.*?)\1/g, (match, quote, content) => {
                const hasMojibake = /ط§|ظ„|طھ|ط£|ط¥|ط­|ط·|ظ…|ط¯|ط©|ï؟½|�/.test(content);
                if (!hasMojibake) return match;
                
                let bytes = [];
                for (let i = 0; i < content.length; i++) {
                    const char = content[i];
                    if (reverseMap[char] !== undefined) {
                        bytes.push(reverseMap[char]);
                    } else if (char === '�' || char === '?') {
                        bytes.push(0x3F);
                    } else {
                        bytes.push(char.charCodeAt(0) & 0xFF);
                    }
                }
                try {
                    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
                    return quote + decoded + quote;
                } catch (e) {
                    return match;
                }
            });
        } catch (e) {
            return code;
        }
    }

    static cleanArtifacts(code) {
        return code
            .replace(/^-- file:.*$/gm, '')
            .replace(/^-- dialect:.*$/gm, '')
            .replace(/^-- encoding:.*$/gm, '')
            .replace(/^-- decompiled by.*$/gm, '')
            .replace(/ -- proto#\d+.*$/gm, '')
            .replace(/-- PHASE_BOUNDARY:\w+\s*/g, '')
            .replace(/-- \[\d+\]\s*/g, '')
            .replace(/\[POL\] - /g, '-- ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    static extractUrls(code) {
        const urls = code.match(/https?:\/\/[^\s"'`]+/g) || [];
        return [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
    }

    static renameVariables(code) {
        let modified = code;
        const map = new Map();
        let varCount = 1;

        const servRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[:\.]GetService\s*\(\s*["']([^"']+)["']\s*\)/g;
        let match;
        while ((match = servRegex.exec(code)) !== null) {
            map.set(match[1], match[2].replace(/[^a-zA-Z0-9_]/g, "") + "_Service");
        }

        const instRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*Instance\.new/g;
        while ((match = instRegex.exec(code)) !== null) {
            if (!map.has(match[1])) {
                map.set(match[1], "Inst_" + varCount++);
            }
        }

        const localRegex = /local\s+([a-zA-Z0-9_]+)/g;
        while ((match = localRegex.exec(code)) !== null) {
            const v = match[1];
            if (v.match(/^[rpL]\d+_\d+$/) && !map.has(v)) {
                map.set(v, "Var_" + varCount++);
            }
        }

        const paramRegex = /function\s*\(([^)]+)\)/g;
        while ((match = paramRegex.exec(code)) !== null) {
            match[1].split(',').forEach(p => {
                const v = p.trim();
                if (v.match(/^[rp]\d+_\d+$/) && !map.has(v)) {
                    map.set(v, "Param_" + varCount++);
                }
            });
        }

        const forRegex = /for\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s+in/g;
        while ((match = forRegex.exec(code)) !== null) {
            if (match[1].match(/^[rp]\d+_\d+$/) && !map.has(match[1])) map.set(match[1], "Key_" + varCount++);
            if (match[2].match(/^[rp]\d+_\d+$/) && !map.has(match[2])) map.set(match[2], "Value_" + varCount++);
        }
        
        const numForRegex = /for\s+([a-zA-Z0-9_]+)\s*=\s*/g;
        while ((match = numForRegex.exec(code)) !== null) {
            if (match[1].match(/^[rp]\d+_\d+$/) && !map.has(match[1])) map.set(match[1], "Index_" + varCount++);
        }

        const globalRegex = /^([a-zA-Z0-9_]+)\s*=/gm;
        while ((match = globalRegex.exec(code)) !== null) {
            if (match[1].match(/^[rpL]\d+_\d+$/) && !map.has(match[1])) map.set(match[1], "Global_" + varCount++);
        }

        const sorted = Array.from(map.keys()).sort((a, b) => b.length - a.length);
        for (const oldName of sorted) {
            const newName = map.get(oldName);
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modified = modified.replace(regex, newName);
        }

        return modified;
    }

    static beautify(code) {
        const lines = code.split('\n');
        let indent = 0;
        const result = [];
        
        for (let i = 0; i < lines.length; i++) {
            let trimmed = lines[i].trim();
            if (!trimmed) continue;
            
            if (/^(end|else|elseif|until|\})/i.test(trimmed)) {
                indent = Math.max(0, indent - 1);
            }
            
            result.push("    ".repeat(indent) + trimmed);
            
            const isComment = trimmed.startsWith('--');
            if (!isComment) {
                if (/\bfunction\b/i.test(trimmed) && !/\bend\b/i.test(trimmed)) {
                    indent++;
                } else if (/\bthen\b\s*$/i.test(trimmed) && !/\bend\b/i.test(trimmed)) {
                    indent++;
                } else if (/\bdo\b\s*$/i.test(trimmed) && !/\bend\b/i.test(trimmed)) {
                    indent++;
                } else if (/\brepeat\b\s*$/i.test(trimmed)) {
                    indent++;
                } else if (/^\s*else\s*$/i.test(trimmed)) {
                    indent++;
                } else if (/\{\s*$/i.test(trimmed)) {
                    indent++;
                }
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
