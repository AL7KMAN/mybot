const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                let processedText = decompileResult.text;
                
                try { processedText = MoonsecBridge.fixMojibake(processedText); } catch (e) {}
                try { processedText = MoonsecBridge.deepClean(processedText); } catch (e) {}
                try { processedText = MoonsecBridge.massiveRenameEngine(processedText); } catch (e) {}

                return { text: processedText, urls: MoonsecBridge.extractUrls(processedText), decompiler: decompileResult.decompiler };
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
        
        const errorMsg = `Rust: ${rsResult.error} | Java: ${javaResult.error}`;
        return { isBytecode: true, error: errorMsg };
    }

    static fixMojibake(str) {
        if (!str) return str;
        try {
            const decoder = new TextDecoder('windows-1256');
            const win1256Map = {};
            for (let i = 0; i < 256; i++) {
                win1256Map[decoder.decode(new Uint8Array([i]))] = i;
            }

            let bytes = [];
            let hasMojibake = false;
            for (let i = 0; i < str.length; i++) {
                const char = str.charAt(i);
                if (win1256Map[char] !== undefined) {
                    bytes.push(win1256Map[char]);
                    if (win1256Map[char] > 127) hasMojibake = true;
                } else {
                    bytes.push(str.charCodeAt(i) & 0xFF);
                }
            }

            if (!hasMojibake) return str;
            const utf8Decoder = new TextDecoder('utf-8', { fatal: false });
            return utf8Decoder.decode(new Uint8Array(bytes));
        } catch (e) {
            return str;
        }
    }

    static deepClean(code) {
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
        return finalCode;
    }

    static extractUrls(code) {
        const urls = code.match(/https?:\/\/[^\s"'`]+/g) || [];
        return [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);
    }

    static massiveRenameEngine(code) {
        let modified = code;
        const renameMap = new Map();
        const usedNames = new Set();
        
        const safeAdd = (oldName, newName) => {
            if (!oldName || !newName) return;
            if (!oldName.match(/^[a-zA-Z0-9_]+$/)) return;
            if (renameMap.has(oldName)) return;
            if (!oldName.match(/^[rp]\d+_\d+$/)) return;
            
            let baseName = newName;
            let counter = 1;
            while (usedNames.has(newName)) {
                newName = baseName + "_" + counter;
                counter++;
            }
            
            usedNames.add(newName);
            renameMap.set(oldName, newName);
        };

        const passServices = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\w+[:\.]GetService\s*\(\s*["']([^"']+)["']\s*\)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
                safeAdd(match[1], clean + "_Service");
            }
        };

        const passInstances = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*Instance\.new\s*\(\s*["']([^"']+)["']/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
                safeAdd(match[1], clean + "_Inst");
            }
        };

        const passLocalPlayer = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.LocalPlayer/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "LocalPlayer");
            }
        };

        const passUiProperties = () => {
            const properties = [
                "Size", "Position", "AnchorPoint", "BackgroundColor3", "BorderSizePixel", 
                "Visible", "Active", "Draggable", "Text", "TextColor3", "TextScaled", 
                "Font", "ZIndex", "CornerRadius", "PlaceholderText", "CanvasSize", 
                "ScrollBarThickness", "SortOrder", "Padding", "Image", "Parent"
            ];
            properties.forEach(prop => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*[a-zA-Z0-9_]+\\[\\s*["']${prop}["']\\s*\\]`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) {
                    safeAdd(match[1], prop + "_Val");
                }
            });
        };

        const passFunctions = () => {
            const regex = /local\s+function\s+([a-zA-Z0-9_]+)\s*\(/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Function_" + count++);
            }
        };

        const passTables = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\{\s*[^}]+\}/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Table_" + count++);
            }
        };

        const passLoops = () => {
            const regex = /for\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s+in\s+[^\n]+do/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Index");
                safeAdd(match[2], "Value");
            }
        };

        const passEvents = () => {
            const events = ["Connect", "MouseButton1Click", "RenderStepped", "PlayerAdded", "PlayerRemoving"];
            events.forEach(ev => {
                const regex = new RegExp(`:\\s*${ev}\\s*\\(\\s*function\\s*\\(\\s*([a-zA-Z0-9_]+)?\\s*\\)`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) {
                    if (match[1]) safeAdd(match[1], ev + "_Arg");
                }
            });
        };

        const passConnections = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\\s*:\\s*Connect\\s*\\(/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Connection_" + count++);
            }
        };

        const passMath = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*math\.(floor|ceil|abs|sqrt|random|clamp)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Math_" + match[2].charAt(0).toUpperCase() + match[2].slice(1));
            }
        };

        const passStrings = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*string\.(format|lower|upper|sub|gsub|find|match)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "String_" + match[2].charAt(0).toUpperCase() + match[2].slice(1));
            }
        };

        const passTablesCalls = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*table\.(insert|remove|concat|unpack|sort)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "TableOp_" + match[2].charAt(0).toUpperCase() + match[2].slice(1));
            }
        };

        const passBooleans = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*(true|false)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Is" + match[2].charAt(0).toUpperCase() + match[2].slice(1));
            }
        };

        const passNumbers = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*-?\d+/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Number_" + count++);
            }
        };

        const passStringLiterals = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*["']/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "StringLiteral_" + count++);
            }
        };

        const passRemainingLocals = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                if (!renameMap.has(match[1]) && match[1].match(/^[rp]\d+_\d+$/)) {
                    safeAdd(match[1], "UnknownVar_" + count++);
                }
            }
        };

        const passGlobalAssignments = () => {
            const regex = /^([a-zA-Z0-9_]+)\s*=\s*/gm;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                if (match[1].match(/^[rp]\d+_\d+$/)) {
                    safeAdd(match[1], "GlobalVar_" + match[1]);
                }
            }
        };

        const applyRenames = () => {
            const sortedKeys = Array.from(renameMap.keys()).sort((a, b) => b.length - a.length);
            for (const oldName of sortedKeys) {
                const newName = renameMap.get(oldName);
                const regex = new RegExp(`\\b${oldName}\\b`, 'g');
                modified = modified.replace(regex, newName);
            }
        };

        passServices();
        passInstances();
        passLocalPlayer();
        passUiProperties();
        passFunctions();
        passTables();
        passLoops();
        passEvents();
        passConnections();
        passMath();
        passStrings();
        passTablesCalls();
        passBooleans();
        passNumbers();
        passStringLiterals();
        passRemainingLocals();
        passGlobalAssignments();

        applyRenames();

        return modified;
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
