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

                const step1 = spawn("/opt/venv/bin/python3", [
                    path.join(__dirname, "tools/wearedevs/deobfuscator.py"),
                    inputFile
                ], { timeout: 300000, cwd: path.join(__dirname, "tools/wearedevs") });

                let step1Stdout = "";
                let step1Stderr = "";
                step1.stdout.on("data", (d) => step1Stdout += d.toString());
                step1.stderr.on("data", (d) => step1Stderr += d.toString());

                step1.on("close", (code) => {
                    if (step1Stdout.length < 100) {
                        return reject(new Error(`Dumper failed (Code ${code}). Stderr: ${step1Stderr.slice(0, 500)}`));
                    }

                    fs.writeFileSync(reportPath, step1Stdout);

                    const traceToLuaPath = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                    if (!fs.existsSync(traceToLuaPath)) {
                        return reject(new Error("trace_to_lua.py not found"));
                    }

                    const step2 = spawn("/opt/venv/bin/python3", [
                        traceToLuaPath, reportPath
                    ], { timeout: 120000, cwd: path.join(__dirname, "tools/wearedevs") });

                    let step2Stdout = "";
                    let step2Stderr = "";
                    step2.stdout.on("data", (d) => step2Stdout += d.toString());
                    step2.stderr.on("data", (d) => step2Stderr += d.toString());

                    step2.on("close", (code2) => {
                        const candidates = [
                            outputPath,
                            path.join(dir, "deobfuscated.lua"),
                            path.join(__dirname, "tools/wearedevs/deobfuscated.lua"),
                            path.join(process.cwd(), "deobfuscated.lua")
                        ];

                        for (const p of candidates) {
                            if (fs.existsSync(p) && fs.statSync(p).size > 50) {
                                const content = fs.readFileSync(p, "utf-8");
                                if (!content.includes("local Constants") && !content.includes("UNPACK CALLED")) {
                                    return resolve(content);
                                }
                            }
                        }

                        if (step2Stdout.length > 100 && !step2Stdout.includes("local Constants") && !step2Stdout.includes("UNPACK CALLED")) {
                            return resolve(step2Stdout);
                        }

                        reject(new Error(`Converter failed (Code ${code2}). Stderr: ${step2Stderr.slice(0, 300)}`));
                    });
                });
            } else if (tool === "prometheus") {
                const proc = spawn("/opt/venv/bin/python3", [
                    path.join(__dirname, "tools/prometheus/pol.py"),
                    inputFile
                ], { timeout: 180000 });

                let out = "";
                let err = "";
                proc.stdout.on("data", (d) => out += d.toString());
                proc.stderr.on("data", (d) => err += d.toString());
                proc.on("close", (code) => {
                    const outPath = path.join(path.dirname(inputFile), "output.lua");
                    if (fs.existsSync(outPath)) return resolve(fs.readFileSync(outPath, "utf-8"));
                    if (out.length > 50) return resolve(out);
                    reject(new Error(`Prometheus failed (${code}): ${err.slice(0, 300)}`));
                });
            } else if (tool === "moonsec") {
                const proc = spawn("dotnet", [
                    path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll"),
                    "-dev", "-i", inputFile, "-o", inputFile + ".luac"
                ], { timeout: 120000 });

                let err = "";
                proc.stderr.on("data", (d) => err += d.toString());
                proc.on("close", (code) => {
                    if (code === 0) {
                        try {
                            const luacData = fs.readFileSync(inputFile + ".luac");
                            return resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                        } catch (e) {
                            return reject(new Error("Moonsec output missing"));
                        }
                    }
                    reject(new Error(`Moonsec failed (${code}): ${err.slice(0, 300)}`));
                });
            } else {
                reject(new Error("Unknown tool: " + tool));
            }
        });
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath], { timeout: 60000 });
            let out = "";
            let err = "";
            proc.stdout.on("data", (d) => out += d.toString());
            proc.stderr.on("data", (d) => err += d.toString());
            proc.on("close", (code) => {
                if (code === 0) resolve(out);
                else reject(new Error(`unluac failed (${code}): ${err.slice(0, 300)}`));
            });
        });
    }
}

module.exports = { PythonBridge };
