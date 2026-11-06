const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static async run(tool, inputFile) {
        return new Promise((resolve, reject) => {
            if (tool === "wearedevs") {
                const dir = path.dirname(inputFile);
                const reportPath = path.join(dir, "report.txt");
                const outputPath = path.join(dir, "deobfuscated.lua");
                
                const step1 = spawn("/opt/venv/bin/python3", [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile], { timeout: 300000 });
                let stdout = "";
                
                step1.stdout.on("data", (d) => stdout += d.toString());
                
                step1.on("close", () => {
                    fs.writeFileSync(reportPath, stdout);
                    
                    const traceToLuaPath = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                    if (!fs.existsSync(traceToLuaPath)) {
                        return reject(new Error("trace_to_lua.py not found in tools/wearedevs"));
                    }
                    
                    const step2 = spawn("/opt/venv/bin/python3", [traceToLuaPath, reportPath], { timeout: 60000 });
                    let convertedCode = "";
                    
                    step2.stdout.on("data", (d) => convertedCode += d.toString());
                    
                    step2.on("close", () => {
                        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10) {
                            return resolve(fs.readFileSync(outputPath, "utf-8"));
                        }
                        if (convertedCode && convertedCode.length > 10) {
                            return resolve(convertedCode);
                        }
                        reject(new Error("Converter failed to produce clean code."));
                    });
                });
            } else if (tool === "prometheus") {
                const proc = spawn("/opt/venv/bin/python3", [path.join(__dirname, "tools/prometheus/pol.py"), inputFile], { timeout: 180000 });
                let out = "";
                proc.stdout.on("data", (d) => out += d.toString());
                proc.on("close", () => {
                    const outPath = path.join(path.dirname(inputFile), "output.lua");
                    if (fs.existsSync(outPath)) resolve(fs.readFileSync(outPath, "utf-8"));
                    else resolve(out);
                });
            } else if (tool === "moonsec") {
                const proc = spawn("dotnet", [path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll"), "-dev", "-i", inputFile, "-o", inputFile + ".luac"], { timeout: 120000 });
                proc.on("close", (code) => {
                    if (code === 0) {
                        try {
                            const luacData = fs.readFileSync(inputFile + ".luac");
                            resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                        } catch (e) {
                            reject(new Error("Failed to read Moonsec output"));
                        }
                    } else {
                        reject(new Error("Moonsec failed"));
                    }
                });
            } else {
                reject(new Error("Unknown tool"));
            }
        });
    }
}

module.exports = { PythonBridge };
