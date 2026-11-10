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
                try { code = MoonsecBridge.fixMojibake(code); } catch (e) {}
                try { code = MoonsecBridge.removeArtifacts(code); } catch (e) {}
                try { code = MoonsecBridge.megaRenameEngine(code); } catch (e) {}
                try { code = MoonsecBridge.advancedBeautify(code); } catch (e) {}
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
            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { timeout: 180000, killSignal: 'SIGKILL' });
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("error", (err) => resolve({ success: false, error: `spawn failed: ${err.message}` }));
            proc.on("close", (code, signal) => {
                if (fs.existsSync(luacFile) && fs.statSync(luacFile).size > 10) return resolve({ success: true, luacFile });
                if (signal === "SIGKILL") return resolve({ success: false, error: `DLL killed by timeout after 180s. ${stderr.slice(-200)}` });
                resolve({ success: false, error: `DLL exit ${code}: ${stderr.slice(-300)}` });
            });
        });
    }

    static async tryDecompress(luacFile) {
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, ["-i", luacFile], 60000);
        if (rsResult.success && rsResult.out.length > 50) return { text: rsResult.out, decompiler: "unluac-rs (Rust)" };
        
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) return { text: javaResult.out, decompiler: "unluac (Java)" };
        
        return { isBytecode: true, error: `Rust: ${rsResult.error} | Java: ${javaResult.error}` };
    }

    static fixMojibake(str) {
        if (!str || typeof str !== 'string') return str;
        try {
            const win1256Bytes = new Uint8Array(str.length);
            let hasMojibake = false;
            for (let i = 0; i < str.length; i++) {
                const code = str.charCodeAt(i);
                if (code >= 0xC0 && code <= 0xFF) { win1256Bytes[i] = code; hasMojibake = true; }
                else if (code === 0xA4 || code === 0xA6 || code === 0xA8 || code === 0xAA) { win1256Bytes[i] = code; hasMojibake = true; }
                else { win1256Bytes[i] = code & 0xFF; }
            }
            if (!hasMojibake) return str;
            return new TextDecoder('utf-8', { fatal: false }).decode(win1256Bytes);
        } catch (e) { return str; }
    }

    static removeArtifacts(code) {
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

    static megaRenameEngine(code) {
        let modified = code;
        const renameMap = new Map();
        const usedNames = new Set();
        const scopeNames = new Set();

        const safeAdd = (oldName, newNameBase, forceScope = false) => {
            if (!oldName || !newNameBase) return;
            if (renameMap.has(oldName)) return;
            if (!oldName.match(/^[a-zA-Z0-9_]+$/)) return;
            if (!oldName.match(/^[rp]\d+_\d+$/) && !oldName.match(/^L\d+_\d+$/) && !oldName.match(/^\w+_\d+$/)) return;

            let finalName = newNameBase;
            let counter = 1;
            const nameSet = forceScope ? scopeNames : usedNames;

            while (nameSet.has(finalName) || usedNames.has(finalName)) {
                finalName = newNameBase + "_" + counter++;
            }
            nameSet.add(finalName);
            usedNames.add(finalName);
            renameMap.set(oldName, finalName);
        };

        const getServiceNames = ["Players", "RunService", "SoundService", "StarterGui", "Workspace", "Lighting", "ReplicatedStorage", "ServerStorage", "ServerScriptService", "TweenService", "UserInputService", "ContextActionService", "MarketplaceService", "TeleportService", "HttpService", "DataStoreService", "PathfindingService", "PhysicsService", "CollectionService"];
        getServiceNames.forEach(svc => {
            const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*[a-zA-Z0-9_]+[:.]GetService\\s*\\(\\s*["']${svc}["']\\s*\\)`, "g");
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], svc + "_Service");
        });

        const instanceNames = ["Frame", "TextLabel", "TextButton", "TextBox", "ScrollingFrame", "ScreenGui", "ImageLabel", "ImageButton", "UICorner", "UIListLayout", "UIPadding", "UIGridLayout", "UIStroke", "Sound", "Part", "WedgePart", "MeshPart", "RemoteEvent", "RemoteFunction", "BindableEvent", "Folder", "Model", "Camera", "Highlight", "BillboardGui", "SurfaceGui", "Attachment", "Beam", "Trail", "ParticleEmitter", "PointLight", "SpotLight", "SurfaceLight"];
        instanceNames.forEach(inst => {
            const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*Instance\\.new\\s*\\(\\s*["']${inst}["']`, "g");
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], inst + "_Instance");
        });

        const passLocalPlayer = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*([a-zA-Z0-9_]+)\.LocalPlayer/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "LocalPlayer");
        };

        const passPlayerEvents = () => {
            const events = ["PlayerAdded", "PlayerRemoving", "CharacterAdded", "CharacterRemoving", "ChildAdded", "ChildRemoved", "DescendantAdded", "DescendantRemoving"];
            events.forEach(ev => {
                const regex = new RegExp(`\\b([a-zA-Z0-9_]+)\\.${ev}\\s*:\\s*Connect\\s*\\(\\s*function\\s*\\(\\s*([a-zA-Z0-9_]+)?\\s*\\)`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) {
                    if (match[2]) safeAdd(match[2], ev.replace("Added", "").replace("Removing", "") + "Player");
                }
            });
        };

        const passUiProperties = () => {
            const props = [
                "Size", "Position", "AnchorPoint", "BackgroundColor3", "BackgroundTransparency",
                "BorderSizePixel", "BorderColor3", "Visible", "Active", "Draggable", "Text",
                "TextColor3", "TextSize", "TextScaled", "TextWrapped", "Font", "ZIndex",
                "CornerRadius", "PlaceholderText", "PlaceholderColor3", "CanvasSize",
                "CanvasPosition", "ScrollBarThickness", "SortOrder", "Padding", "Image",
                "ImageColor3", "ImageTransparency", "Parent", "Name", "ClassName", "Value",
                "MaxValue", "MinValue", "SoundId", "Volume", "PlaybackSpeed", "Looped",
                "Ambient", "OutdoorAmbient", "Brightness", "ClockTime", "FogEnd", "FogStart",
                "FieldOfView", "CameraType", "CameraSubject", "CFrame", "Orientation", "Velocity",
                "AssemblyLinearVelocity", "Color", "Material", "Transparency", "Shape",
                "CanCollide", "Anchored", "Massless", "Locked"
            ];
            props.forEach(prop => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*[a-zA-Z0-9_]+\\[\\s*["']${prop}["']\\s*\\]`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], prop + "_Val");
                const regex2 = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*[a-zA-Z0-9_]+\\.${prop}`, "g");
                while ((match = regex2.exec(modified)) !== null) safeAdd(match[1], prop + "_Prop");
            });
        };

        const passFunctions = () => {
            const regex = /local\s+function\s+([a-zA-Z0-9_]+)\s*\(/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Function_" + count++);
        };

        const passTables = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*\{\s*[^}]+\}/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Table_" + count++);
        };

        const passLoops = () => {
            const regex = /for\s+([a-zA-Z0-9_]+)\s*,\s*([a-zA-Z0-9_]+)\s+in\s+[^\n]+do/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                safeAdd(match[1], "Index", true);
                safeAdd(match[2], "Value", true);
            }
            const regex2 = /for\s+([a-zA-Z0-9_]+)\s*=\s*[^\n]+do/g;
            while ((match = regex2.exec(modified)) !== null) safeAdd(match[1], "LoopIndex", true);
        };

        const passEvents = () => {
            const events = ["Connect", "Wait", "Once", "Disconnect", "MouseButton1Click", "MouseButton2Click", "MouseEnter", "MouseLeave", "InputBegan", "InputEnded", "InputChanged", "RenderStepped", "Heartbeat", "Stepped", "Touched", "TouchEnded", "Activated", "Focused", "FocusLost", "Changed", "GetPropertyChangedSignal"];
            events.forEach(ev => {
                const regex = new RegExp(`:\\s*${ev}\\s*\\(\\s*function\\s*\\(\\s*([a-zA-Z0-9_]+)?\\s*\\)`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) {
                    if (match[1]) safeAdd(match[1], ev + "_Arg", true);
                }
            });
        };

        const passConnections = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\s*:\s*(Connect|Once|Wait)\s*\(/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], match[2] + "_Connection_" + count++);
        };

        const passMath = () => {
            const maths = ["floor", "ceil", "abs", "sqrt", "pow", "log", "exp", "sin", "cos", "tan", "asin", "acos", "atan", "atan2", "random", "clamp", "min", "max", "rad", "deg", "fmod", "modf", "huge", "pi"];
            maths.forEach(m => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*math\\.${m}\\s*\\(`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Math_" + m.charAt(0).toUpperCase() + m.slice(1));
            });
        };

        const passStrings = () => {
            const strs = ["format", "lower", "upper", "sub", "gsub", "find", "match", "gmatch", "rep", "reverse", "byte", "char", "len", "split"];
            strs.forEach(s => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*string\\.${s}\\s*\\(`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "String_" + s.charAt(0).toUpperCase() + s.slice(1));
            });
        };

        const passTablesCalls = () => {
            const tbls = ["insert", "remove", "concat", "unpack", "sort", "find", "pack"];
            tbls.forEach(t => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*table\\.${t}\\s*\\(`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Table_" + t.charAt(0).toUpperCase() + t.slice(1));
            });
        };

        const passVectorMath = () => {
            const vectors = ["new", "zero", "one", "xAxis", "yAxis", "zAxis"];
            vectors.forEach(v => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*Vector3\\.${v}\\s*\\(`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Vec3_" + v);
                const regex2 = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*Vector2\\.${v}\\s*\\(`, "g");
                while ((match = regex2.exec(modified)) !== null) safeAdd(match[1], "Vec2_" + v);
            });
        };

        const passCFrames = () => {
            const cframes = ["new", "Angles", "fromEulerAnglesXYZ", "fromAxisAngle", "lookAt", "identity"];
            cframes.forEach(cf => {
                const regex = new RegExp(`local\\s+([a-zA-Z0-9_]+)\\s*=\\s*CFrame\\.${cf}\\s*\\(`, "g");
                let match;
                while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "CF_" + cf);
            });
        };

        const passUDim = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*UDim\.new\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "UDim_Val");
            const regex2 = /local\s+([a-zA-Z0-9_]+)\s*=\s*UDim2\.new\s*\(/g;
            while ((match = regex2.exec(modified)) !== null) safeAdd(match[1], "UDim2_Val");
        };

        const passColors = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*Color3\.(new|fromRGB|fromHSV|fromHex)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Color_" + match[2]);
        };

        const passTweens = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+\.Create\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Tween");
        };

        const passWaitForChild = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+[:.]WaitForChild\s*\(\s*["']([^"']+)["']\s*\)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
                safeAdd(match[1], clean + "_Child");
            }
        };

        const passFindFirstChild = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*[a-zA-Z0-9_]+[:.]FindFirstChild\s*\(\s*["']([^"']+)["']\s*\)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                const clean = match[2].replace(/[^a-zA-Z0-9_]/g, "");
                safeAdd(match[1], clean + "_Child");
            }
        };

        const passBooleans = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*(true|false)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Is" + match[2].charAt(0).toUpperCase() + match[2].slice(1));
        };

        const passNumbers = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*-?\d+(\.\d+)?/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Number_" + count++);
        };

        const passStringLiterals = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*["']/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Str_" + count++);
        };

        const passIPairsPairs = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*(ipairs|pairs)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], match[2].charAt(0).toUpperCase() + match[2].slice(1) + "_Iter");
        };

        const passTypeOf = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*typeof\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "TypeOf_Result");
        };

        const passTick = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*tick\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "CurrentTime");
        };

        const passOsTime = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)\s*=\s*os\.(time|clock|date)\s*\(/g;
            let match;
            while ((match = regex.exec(modified)) !== null) safeAdd(match[1], "Os_" + match[2]);
        };

        const passParameters = () => {
            const regex = /local\s+function\s+[a-zA-Z0-9_]+\s*\(\s*([a-zA-Z0-9_]+)\s*\)/g;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                if (match[1].match(/^[rp]\d+_\d+$/) || match[1].match(/^p\d+_\d+$/)) {
                    safeAdd(match[1], "Param", true);
                }
            }
        };

        const passGlobalAssignments = () => {
            const regex = /^([a-zA-Z0-9_]+)\s*=\s*/gm;
            let match;
            while ((match = regex.exec(modified)) !== null) {
                if (match[1].match(/^[rp]\d+_\d+$/)) {
                    safeAdd(match[1], "Global_" + match[1]);
                }
            }
        };

        const passRemainingLocals = () => {
            const regex = /local\s+([a-zA-Z0-9_]+)/g;
            let match;
            let count = 1;
            while ((match = regex.exec(modified)) !== null) {
                if (!renameMap.has(match[1]) && (match[1].match(/^[rp]\d+_\d+$/) || match[1].match(/^L\d+_\d+$/))) {
                    safeAdd(match[1], "Var_" + count++);
                }
            }
        };

        passLocalPlayer();
        passPlayerEvents();
        passUiProperties();
        passFunctions();
        passTables();
        passLoops();
        passEvents();
        passConnections();
        passMath();
        passStrings();
        passTablesCalls();
        passVectorMath();
        passCFrames();
        passUDim();
        passColors();
        passTweens();
        passWaitForChild();
        passFindFirstChild();
        passBooleans();
        passNumbers();
        passStringLiterals();
        passIPairsPairs();
        passTypeOf();
        passTick();
        passOsTime();
        passParameters();
        passGlobalAssignments();
        passRemainingLocals();

        const sortedKeys = Array.from(renameMap.keys()).sort((a, b) => b.length - a.length);
        for (const oldName of sortedKeys) {
            const newName = renameMap.get(oldName);
            const regex = new RegExp(`\\b${oldName}\\b`, 'g');
            modified = modified.replace(regex, newName);
        }

        return modified;
    }

    static advancedBeautify(code) {
        const lines = code.split('\n');
        let indent = 0;
        const result = [];
        let inMultilineString = false;
        let multilineStringQuote = "";
        
        for (let line of lines) {
            let trimmed = line.trim();
            
            if (inMultilineString) {
                result.push(line);
                if (trimmed.endsWith(multilineStringQuote)) inMultilineString = false;
                continue;
            }

            if (trimmed.startsWith('[') && trimmed.includes('[')) {
                inMultilineString = true;
                multilineStringQuote = trimmed.substring(0, trimmed.lastIndexOf('[') + 1);
                result.push(line);
                continue;
            }

            if (!trimmed) continue;
            
            if (/^(end|else|elseif|until|\}|\))/i.test(trimmed)) {
                indent = Math.max(0, indent - 1);
            }
            
            let isNegated = false;
            if (/^(local\s+function|function|if|for|while|repeat|do)/i.test(trimmed)) isNegated = true;
            if (/^(end|else|elseif|until|\}|\))/i.test(trimmed)) isNegated = false;

            result.push("    ".repeat(indent) + trimmed);
            
            if (isNegated) {
                if (/(then|do|function|repeat|\{)$/i.test(trimmed) || trimmed === "do") {
                    indent++;
                }
            } else if (/(then|do|function|repeat|\{)$/i.test(trimmed)) {
                indent++;
            }
            
            if (/^(else|elseif)/i.test(trimmed)) indent++;
            if (/(else|elseif).*(then)$/i.test(trimmed)) indent++;
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
