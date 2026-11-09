const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const luaparse = require("luaparse");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                try {
                    decompileResult.text = MoonsecBridge.inferVariableNames(decompileResult.text);
                } catch (astError) {}
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
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        
        // استخدام جافا أولاً لأننا عدلنا الترميز فيها
        const javaResult = await MoonsecBridge.tryRun("java", ["-Dfile.encoding=ISO-8859-1", "-Dstdout.encoding=ISO-8859-1", "-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) {
            return MoonsecBridge.formatOutput(javaResult.out, "unluac (Java)");
        }
        
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, ["-i", luacFile], 60000);
        if (rsResult.success && rsResult.out.length > 50) {
            return MoonsecBridge.formatOutput(rsResult.out, "unluac-rs (Rust)");
        }
        
        const errorMsg = `Java: ${javaResult.error} | Rust: ${rsResult.error}`;
        return { isBytecode: true, error: errorMsg };
    }
    
    static formatOutput(code, source) {
        let finalCode = code;
        
        // تحويل النص من الترميز الخام إلى العربي
        try {
            const buf = Buffer.from(finalCode, 'binary');
            const decoder = new TextDecoder('windows-1256');
            finalCode = decoder.decode(buf);
        } catch (e) {}

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

    static inferVariableNames(luaCode) {
        let modifiedCode = luaCode;
        const renameMap = new Map();

        try {
            const ast = luaparse.parse(luaCode);
            
            const traverse = (node) => {
                if (!node) return;

                if (node.type === 'LocalStatement') {
                    for (let i = 0; i < node.variables.length; i++) {
                        const varNode = node.variables[i];
                        const initNode = node.init[i];
                        
                        if (varNode && varNode.type === 'Identifier' && initNode && initNode.type === 'CallExpression') {
                            const base = initNode.base;
                            const args = initNode.arguments || [];
                            
                            let newName = null;

                            if (base && base.type === 'MemberExpression' && base.identifier && base.identifier.name === 'GetService') {
                                if (args.length > 0 && args[0].type === 'StringLiteral') {
                                    newName = args[0].value.replace(/[^a-zA-Z0-9_]/g, "") + "_Service";
                                }
                            }
                            
                            if (base && base.type === 'MemberExpression' && base.base && base.base.name === 'Instance' && base.identifier && base.identifier.name === 'new') {
                                if (args.length > 0 && args[0].type === 'StringLiteral') {
                                    newName = args[0].value.replace(/[^a-zA-Z0-9_]/g, "") + "_Inst";
                                }
                            }

                            if (newName && (varNode.name.startsWith('r') || varNode.name.startsWith('p'))) {
                                renameMap.set(varNode.name, newName);
                            }
                        }
                    }
                }

                for (let key in node) {
                    if (node[key] && typeof node[key] === 'object') {
                        if (Array.isArray(node[key])) {
                            node[key].forEach(traverse);
                        } else {
                            traverse(node[key]);
                        }
                    }
                }
            };

            traverse(ast);
        } catch (e) {}

        renameMap.forEach((newName, oldName) => {
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modifiedCode = modifiedCode.replace(regex, newName);
        });

        return modifiedCode;
    }
    
    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let out = "", err = "";
                
                proc.stdout.on("data", (data) => { out += data.toString('binary'); });
                proc.stderr.on("data", (data) => { err += data.toString('utf8'); });
                
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
