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
                
                const step1 = spawn("/opt/venv/bin/python3", [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile], { timeout: 120000 });
                let step1Output = "";
                let step1Error = "";
                
                step1.stdout.on("data", (d) => step1Output += d.toString());
                step1.stderr.on("data", (d) => step1Error += d.toString());
                
                step1.on("close", (code) => {
                    fs.writeFileSync(reportPath, step1Output);
                    
                    const traceToLuaPath = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                    if (!fs.existsSync(traceToLuaPath)) {
                        return reject(new Error("trace_to_lua.py not found in tools/wearedevs"));
                    }
                    
                    const step2 = spawn("/opt/venv/bin/python3", [traceToLuaPath, reportPath], { timeout: 60000 });
                    let step2Output = "";
                    let step2Error = "";
                    
                    step2.stdout.on("data", (d) => step2Output += d.toString());
                    step2.stderr.on("data", (d) => step2Error += d.toString());
                    
                    step2.on("close", (code2) => {
                        if (code2 === 0 && fs.existsSync(outputPath)) {
                            resolve(fs.readFileSync(outputPath, "utf-8"));
                        } else {
                            reject(new Error(`Converter failed (Code ${code2}). STDERR: ${step2Error.slice(0, 500)}`));
                        }
                    });
                });
            } else if (tool === "prometheus") {
                const proc = spawn("/opt/venv/bin/python3", [path.join(__dirname, "tools/prometheus/pol.py"), inputFile], { timeout: 120000 });
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
