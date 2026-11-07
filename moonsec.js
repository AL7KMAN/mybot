const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { LuaSandbox } = require("./sandbox.js");

class MoonsecBridge {
    static async run(inputFile) {
        const originalCode = fs.readFileSync(inputFile, "utf-8");
        
        let sandboxResult = { captures: [], logs: "", error: null };
        try {
            sandboxResult = await LuaSandbox.run(originalCode);
        } catch (e) {
            sandboxResult.error = e.message;
        }

        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const unluacPath = "/root/.cargo/bin/unluac-cli";

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { 
                timeout: 60000, 
                killSignal: 'SIGKILL' 
            });
            
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                resolve(buildFinalOutput(sandboxResult, null, `Failed to start Moonsec DLL: ${err.message}`));
            });

            proc.on("close", (code) => {
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return resolve(buildFinalOutput(sandboxResult, null, `Moonsec DLL failed: ${stderr.slice(-500)}`));
                }

                const unluacProc = spawn(unluacPath, [luacFile], { 
                    timeout: 60000, 
                    killSignal: 'SIGKILL' 
                });
                
                let out = "", err = "";
                unluacProc.stdout.on("data", (data) => { out += data.toString(); });
                unluacProc.stderr.on("data", (data) => { err += data.toString(); });

                unluacProc.on("error", (jErr) => {
                    const luacData = fs.readFileSync(luacFile);
                    resolve(buildFinalOutput(sandboxResult, "BYTECODE_HEX:" + luacData.toString("hex"), "Decompiler engine failed to start."));
                });

                unluacProc.on("close", (jCode) => {
                    if (jCode === 0 && out.length > 20) {
                        resolve(buildFinalOutput(sandboxResult, out, null));
                    } else {
                        const luacData = fs.readFileSync(luacFile);
                        resolve(buildFinalOutput(sandboxResult, "BYTECODE_HEX:" + luacData.toString("hex"), "Decompiler failed to reconstruct control flow."));
                    }
                });
            });
        });
    }
}

function buildFinalOutput(sandboxResult, decompiledCode, decompileError) {
    let output = "=== MOONSEC DEOBFUSCATION REPORT ===\n\n";

    if (sandboxResult.captures && sandboxResult.captures.length > 0) {
        output += "✅ [SANDBOX] Successfully captured payloads from runtime execution!\n";
        output += "--- CAPTURED PAYLOADS ---\n";
        sandboxResult.captures.forEach((cap, idx) => {
            output += `\n[Payload ${idx + 1}]\n${cap}\n`;
        });
        output += "\n--------------------------\n\n";
    }

    if (sandboxResult.logs) {
        output += "📝 [SANDBOX] Execution Logs (HttpGet, Require, Print):\n";
        output += sandboxResult.logs + "\n\n";
    }

    if (sandboxResult.error) {
        output += `⚠️ [SANDBOX] Error during execution: ${sandboxResult.error}\n\n`;
    }

    if (decompileError) {
        output += `⚠️ [DECOMPILER] ${decompileError}\n\n`;
    }

    if (decompiledCode && !decompiledCode.startsWith("BYTECODE_HEX:")) {
        output += "✅ [DECOMPILER] Successfully decompiled Bytecode to Lua:\n\n" + decompiledCode;
        return output;
    }

    if (decompiledCode && decompiledCode.startsWith("BYTECODE_HEX:")) {
        output += "❌ [DECOMPILER] Could not decompile to Lua. Here is the raw Bytecode (Hex):\n\n";
        output += decompiledCode + "\n";
    } else if (!decompiledCode) {
        output += "❌ [DECOMPILER] Failed to extract bytecode entirely.\n";
    }

    return output;
}

module.exports = { MoonsecBridge };
