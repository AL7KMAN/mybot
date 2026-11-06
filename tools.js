const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static async run(tool, inputFile) {
        return new Promise((resolve, reject) => {
            let cmd, args;
            if (tool === "prometheus") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/prometheus/pol.py"), inputFile];
            } else if (tool === "wearedevs") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile];
            } else if (tool === "moonsec") {
                cmd = "dotnet";
                args = [path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll"), "-dev", "-i", inputFile, "-o", inputFile + ".luac"];
            } else {
                return reject(new Error("Unknown tool"));
            }
            
            const proc = spawn(cmd, args, { timeout: 120000 });
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("close", (code) => {
                if (code === 0) {
                    if (tool === "moonsec") {
                        try {
                            const luacData = fs.readFileSync(inputFile + ".luac");
                            resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                        } catch (e) {
                            reject(new Error("Failed to read Moonsec output"));
                        }
                    } else {
                        const dir = path.dirname(inputFile);
                        const possibleFiles = [
                            "deobfuscated.lua", 
                            "output.lua", 
                            "result.lua", 
                            "reconstructed.lua",
                            inputFile.replace(".lua", "_deobfuscated.lua")
                        ];
                        
                        let finalCode = null;
                        for (const f of possibleFiles) {
                            const fullPath = path.join(dir, f);
                            if (fs.existsSync(fullPath)) {
                                finalCode = fs.readFileSync(fullPath, "utf-8");
                                if (finalCode.length > 50) break;
                            }
                        }

                        if (finalCode && finalCode.length > 50) {
                            resolve(finalCode);
                        } else {
                            resolve(stdout || "Tool finished, but no output file found.");
                        }
                    }
                } else {
                    reject(new Error(`Tool Error (${code}): ${stderr.slice(0, 1500)}`));
                }
            });
        });
    }
}

module.exports = { PythonBridge };
