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
                
                const step1 = spawn("/opt/venv/bin/python3", [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile], { timeout: 300000, cwd: dir });
                let step1Output = "";
                
                step1.stdout.on("data", (d) => step1Output += d.toString());
                
                step1.on("close", (code) => {
                    fs.writeFileSync(reportPath, step1Output);
                    
                    const traceToLuaPath = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                    
                    const step2 = spawn("/opt/venv/bin/python3", [traceToLuaPath, reportPath, "-o", outputPath], { timeout: 120000, cwd: dir });
                    let step2Output = "";
                    let step2Error = "";
                    
                    step2.stdout.on("data", (d) => step2Output += d.toString());
                    step2.stderr.on("data", (d) => step2Error += d.toString());
                    
                    step2.on("close", (code2) => {
                        const possibleOutputs = [
                            outputPath,
                            path.join(dir, "deobfuscated.lua"),
                            path.join(__dirname, "tools/wearedevs/deobfuscated.lua"),
                            path.join(process.cwd(), "deobfuscated.lua")
                        ];
                        
                        for (const p of possibleOutputs) {
                            if (fs.existsSync(p) && fs.statSync(p).size > 50) {
                                const content = fs.readFileSync(p, "utf-8");
                                if (!content.includes("local Constants") && !content.includes("UNPACK CALLED")) {
                                    return resolve(content);
                                }
                            }
                        }
                        
                        if (step2Output && !step2Output.includes("local Constants") && !step2Output.includes("UNPACK CALLED") && step2Output.length > 50) {
                            return resolve(step2Output);
                        }
                        
                        reject(new Error(`Converter finished with Code ${code2}. Output files not found. Stderr: ${step2Error.slice(0, 200)}`));
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
