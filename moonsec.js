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
            const dumpResult = await MoonsecBridge.tryDynamicDump(inputFile);
            if (dumpResult.success) {
                return MoonsecBridge.formatOutput(dumpResult.text, "Dynamic RAM Dumper (Stubs Hook)");
            }
        }
        
        return { error: `V2/V3 Pipeline failed. unluac collapsed and dynamic trace hook failed.` };
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

    static async tryDynamicDump(inputFile) {
        return new Promise((resolve) => {
            const dumpOutputFile = inputFile + ".dumped.lua";
            
            const injectorScript = `
                local function makeStub()
                    local stub = {}
                    setmetatable(stub, {
                        __index = function(_, key)
                            return makeStub()
                        end,
                        __call = function()
                            return makeStub()
                        end
                    })
                    return stub
                end

                _G.game = makeStub()
                _G.Instance = makeStub()
                _G.typeof = function() return "Instance" end
                _G.task = makeStub()
                _G.script = makeStub()

                local function saveDump(txt)
                    if txt and #txt > 10 then
                        local file = io.open("${dumpOutputFile.replace(/\\/g, '\\\\')}", "w")
                        if file then
                            file:write(txt)
                            file:close()
                        end
                    end
                end

                local old_loadstring = loadstring
                _G.loadstring = function(txt)
                    saveDump(txt)
                    return function() end
                end

                local old_load = load
                _G.load = function(txt)
                    saveDump(txt)
                    return function() end
                end

                pcall(function()
                    ${fs.readFileSync(inputFile, "utf-8")}
                end)
            `;
            
            const tempInjectorPath = inputFile + ".injector.lua";
            fs.writeFileSync(tempInjectorPath, injectorScript, "utf-8");

            const proc = spawn("lua", [tempInjectorPath], { timeout: 15000, killSignal: 'SIGKILL' });
            
            proc.on("close", () => {
                try { fs.unlinkSync(tempInjectorPath); } catch(e) {}
                if (fs.existsSync(dumpOutputFile) && fs.statSync(dumpOutputFile).size > 20) {
                    const dumpedText = fs.readFileSync(dumpOutputFile, "utf-8");
                    try { fs.unlinkSync(dumpOutputFile); } catch(e) {}
                    return resolve({ success: true, text: dumpedText });
                }
                resolve({ success: false, error: "Dynamic trace timed out or Roblox dependency caused early halt." });
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
                let out = "", err = "";
                proc.stdout.on("data", (data) => { out += data.toString(); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                
                proc.on("error", () => resolve(null));
                proc.on("close", (code) => {
                    if (code === 0 && out.length > 50) {
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
