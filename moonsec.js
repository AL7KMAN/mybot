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
                } catch (astError) {
                    decompileResult.text = `-- [AST Inference Warning: ${astError.message}]\n` + decompileResult.text;
                }
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
        
        const stringMatches = finalCode.match(/["'](.*?)["']/g);
        if (stringMatches) {
            const uniqueStrings = [...new Set(stringMatches)].filter(s => s.length > 2 && !s.includes('\n') && !s.includes('\\'));
            if (uniqueStrings.length > 0) {
                let printBlock = 'print("=== الاكواد المشفرة داخل السكربت ===")\n';
                uniqueStrings.forEach(s => {
                    printBlock += `print(${s})\n`;
                });
                printBlock += 'print("=====================================")\n\n';
                finalCode = printBlock + finalCode;
            }
        }
        
        const urls = finalCode.match(/https?:\/\/[^\s"'`]+/g) || [];
        const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
        
        return { text: finalCode, urls: uniqueUrls, decompiler: source };
    }

    static inferVariableNames(code) {
        let modified = code;
        const globalMap = new Map();

        modified = MoonsecBridge.renameServices(modified, globalMap);
        modified = MoonsecBridge.renameInstances(modified, globalMap);
        modified = MoonsecBridge.renamePlayers(modified, globalMap);
        modified = MoonsecBridge.renameTime(modified, globalMap);
        modified = MoonsecBridge.renameTables(modified, globalMap);
        modified = MoonsecBridge.renameFunctions(modified, globalMap);
        modified = MoonsecBridge.renameLoops(modified, globalMap);
        modified = MoonsecBridge.renameEvents(modified, globalMap);
        modified = MoonsecBridge.renameFallback(modified, globalMap);

        return modified;
    }

    static applyMap(code, map) {
        let modified = code;
        const sortedKeys = Array.from(map.keys()).sort((a, b) => b.length - a.length);
        for (const oldName of sortedKeys) {
            const newName = map.get(oldName);
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modified = modified.replace(regex, newName);
        }
        return modified;
    }

    static renameServices(code, globalMap) {
        const map = new Map();
        const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[:\.]GetService\s*\(\s*["']([^"']+)["']\s*\)/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const varName = match[1];
            const serviceName = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            map.set(varName, serviceName + "_Service");
            globalMap.set(varName, serviceName + "_Service");
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameInstances(code, globalMap) {
        const map = new Map();
        const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[\.\:]new\s*\(\s*["']([^"']+)["']/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const varName = match[1];
            const className = match[2].replace(/[^a-zA-Z0-9_]/g, "");
            map.set(varName, className + "_Inst");
            globalMap.set(varName, className + "_Inst");
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renamePlayers(code, globalMap) {
        const map = new Map();
        const playerRegex = /local\s+([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.LocalPlayer/g;
        let match;
        while ((match = playerRegex.exec(code)) !== null) {
            map.set(match[1], "LocalPlayer");
            globalMap.set(match[1], "LocalPlayer");
        }
        
        const funcRegex = /local\s+function\s+([a-zA-Z0-9_]+)\s*\(\s*([a-zA-Z0-9_]+)\s*\)/g;
        while ((match = funcRegex.exec(code)) !== null) {
            const paramName = match[2];
            const bodyCheck = new RegExp(`${paramName}\\.UserId`);
            if (bodyCheck.test(code)) {
                map.set(paramName, "TargetPlayer");
                globalMap.set(paramName, "TargetPlayer");
            }
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameTime(code, globalMap) {
        const map = new Map();
        const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*tick\s*\(\s*\)/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            map.set(match[1], "StartTime");
            globalMap.set(match[1], "StartTime");
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameTables(code, globalMap) {
        const map = new Map();
        let counter = 1;
        const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\{\s*[^}]+\}/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            map.set(match[1], "Table_" + counter++);
            globalMap.set(match[1], "Table_" + counter);
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameFunctions(code, globalMap) {
        const map = new Map();
        let counter = 1;
        const regex = /local\s+function\s+([a-zA-Z0-9_]+)\s*\(\s*([a-zA-Z0-9_]*)\s*\)/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const funcName = match[1];
            map.set(funcName, "Function_" + counter++);
            globalMap.set(funcName, "Function_" + counter);
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameLoops(code, globalMap) {
        const map = new Map();
        const regex = /for\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s+in\s+[^\n]+do/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const indexVar = match[1];
            const valueVar = match[2];
            map.set(indexVar, "Index");
            map.set(valueVar, "Item");
            globalMap.set(indexVar, "Index");
            globalMap.set(valueVar, "Item");
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameEvents(code, globalMap) {
        const map = new Map();
        const regex = /:Connect\s*\(\s*function\s*\(\s*([a-zA-Z0-9_]+)?\s*\)/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            if (match[1]) {
                map.set(match[1], "EventData");
                globalMap.set(match[1], "EventData");
            }
        }
        return MoonsecBridge.applyMap(code, map);
    }

    static renameFallback(code, globalMap) {
        const map = new Map();
        let counter = 1;
        const regex = /\b([rp])(\d+)_(\d+)\b/g;
        let match;
        while ((match = regex.exec(code)) !== null) {
            const fullVar = match[0];
            if (!globalMap.has(fullVar) && !map.has(fullVar)) {
                map.set(fullVar, "LM7H_Var_" + counter++);
            }
        }
        return MoonsecBridge.applyMap(code, map);
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
