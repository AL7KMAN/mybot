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
                const luaDir = path.join(__dirname, "tools/wearedevs");

                const step1 = spawn("/opt/venv/bin/python3", [
                    path.join(luaDir, "deobfuscator.py"),
                    inputFile
                ], { timeout: 300000, cwd: dir });

                let s1out = "";
                let s1err = "";
                step1.stdout.on("data", (d) => s1out += d.toString());
                step1.stderr.on("data", (d) => s1err += d.toString());

                step1.on("close", (c1) => {
                    const combined1 = s1out + "\n" + s1err;

                    if (combined1.length < 100) {
                        return reject(new Error(`Dumper failed (Code ${c1}). Out: ${s1out.slice(0,200)} | Err: ${s1err.slice(0,300)}`));
                    }

                    fs.writeFileSync(reportPath, combined1);

                    const traceToLua = path.join(luaDir, "trace_to_lua.py");
                    if (!fs.existsSync(traceToLua)) {
                        return reject(new Error("trace_to_lua.py missing"));
                    }

                    const step2 = spawn("/opt/venv/bin/python3", [
                        traceToLua, reportPath
                    ], { timeout: 120000, cwd: dir });

                    let s2out = "";
                    let s2err = "";
                    step2.stdout.on("data", (d) => s2out += d.toString());
                    step2.stderr.on("data", (d) => s2err += d.toString());

                    step2.on("close", (c2) => {
                        if (s2out && s2out.length > 50 && !s2out.includes("local Constants") && !s2out.includes("UNPACK CALLED")) {
                            return resolve(s2out);
                        }

                        const files = [
                            outputPath,
                            path.join(dir, "deobfuscated.lua"),
                            path.join(luaDir, "deobfuscated.lua"),
                            path.join(process.cwd(), "deobfuscated.lua"),
                            path.join(luaDir, "output.lua")
                        ];

                        for (const p of files) {
                            try {
                                if (fs.existsSync(p) && fs.statSync(p).size > 50) {
                                    const content = fs.readFileSync(p, "utf-8");
                                    if (!content.includes("local Constants") && !content.includes("UNPACK CALLED")) {
                                        return resolve(content);
                                    }
                                }
                            } catch (e) {}
                        }

                        return reject(new Error(`Converter failed (Code ${c2}). Out len: ${s2out.length} | Err: ${s2err.slice(0,300)}`));
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
                    reject(new Error(`Prometheus failed (${code}): ${err.slice(0,300)}`));
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
                    reject(new Error(`Moonsec failed (${code}): ${err.slice(0,300)}`));
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
                else reject(new Error(`unluac failed (${code}): ${err.slice(0,300)}`));
            });
        });
    }
}

module.exports = { PythonBridge };
