const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, "").replace(/\[\d+m/g, "");
    }

    static async run(tool, inputFile) {
        return new Promise((resolve, reject) => {
            if (tool === "wearedevs") {
                const dir = path.dirname(inputFile);
                const luaDir = path.join(__dirname, "tools/wearedevs");
                const reportPath = inputFile + ".report.txt";

                const step1 = spawn("/opt/venv/bin/python3", [
                    path.join(luaDir, "deobfuscator.py"),
                    inputFile
                ], {
                    timeout: 300000,
                    cwd: dir,
                    env: { ...process.env, LUA51_EXECUTABLE: "/app/tools/wearedevs/lua_linux/lua5.1" }
                });

                let s1out = "";
                let s1err = "";
                step1.stdout.on("data", (d) => s1out += d.toString());
                step1.stderr.on("data", (d) => s1err += d.toString());

                step1.on("error", (err) => {
                    reject(new Error(`spawn step1 failed: ${err.message}`));
                });

                step1.on("close", (c1, sig1) => {
                    if (sig1 === "SIGTERM") {
                        return reject(new Error("Dumper timed out after 300s"));
                    }
                    if (c1 !== 0) {
                        return reject(new Error(`Dumper exited (${c1}). Err: ${this.stripAnsi(s1err).slice(-800)}`));
                    }
                    if (!fs.existsSync(reportPath) || fs.statSync(reportPath).size === 0) {
                        return reject(new Error(`Dumper produced no report. Out: ${s1out.slice(0, 200)} | Err: ${s1err.slice(0, 200)}`));
                    }

                    const traceToLua = path.join(luaDir, "trace_to_lua.py");
                    if (!fs.existsSync(traceToLua)) {
                        return reject(new Error("trace_to_lua.py missing"));
                    }

                    const step2 = spawn("/opt/venv/bin/python3", [
                        traceToLua,
                        reportPath
                    ], { timeout: 120000, cwd: dir });

                    let s2out = "";
                    let s2err = "";
                    step2.stdout.on("data", (d) => s2out += d.toString());
                    step2.stderr.on("data", (d) => s2err += d.toString());

                    step2.on("error", (err) => {
                        reject(new Error(`spawn step2 failed: ${err.message}`));
                    });

                    step2.on("close", (c2, sig2) => {
                        if (sig2 === "SIGTERM") {
                            return reject(new Error("trace_to_lua timed out after 120s"));
                        }
                        if (c2 !== 0) {
                            return reject(new Error(`trace_to_lua exited (${c2}). Err: ${this.stripAnsi(s2err).slice(-800)}`));
                        }
                        resolve(this.stripAnsi(s2out));
                    });
                });

                return;
            }

            if (tool === "prometheus") {
                const proc = spawn("/opt/venv/bin/python3", [
                    path.join(__dirname, "tools/prometheus/pol.py"),
                    inputFile
                ], { timeout: 120000 });

                let stdout = "";
                let stderr = "";
                proc.stdout.on("data", (d) => stdout += d.toString());
                proc.stderr.on("data", (d) => stderr += d.toString());
                proc.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
                proc.on("close", (code) => {
                    if (code === 0) return resolve(this.stripAnsi(stdout) || "Success");
                    reject(new Error(`Prometheus Error (${code}): ${this.stripAnsi(stderr).slice(-800)}`));
                });
                return;
            }

            if (tool === "moonsec") {
                const outFile = inputFile + ".luac";
                const proc = spawn("dotnet", [
                    path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll"),
                    "-dev", "-i", inputFile, "-o", outFile
                ], { timeout: 120000 });

                let stderr = "";
                proc.stderr.on("data", (d) => stderr += d.toString());
                proc.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
                proc.on("close", (code) => {
                    if (code !== 0) {
                        return reject(new Error(`Moonsec Error (${code}): ${this.stripAnsi(stderr).slice(-800)}`));
                    }
                    try {
                        const luacData = fs.readFileSync(outFile);
                        resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                    } catch (e) {
                        reject(new Error("Failed to read Moonsec output"));
                    }
                });
                return;
            }

            reject(new Error(`Unknown tool: ${tool}`));
        });
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath], { timeout: 60000 });
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (d) => stdout += d.toString());
            proc.stderr.on("data", (d) => stderr += d.toString());
            proc.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
            proc.on("close", (code) => {
                if (code === 0) return resolve(stdout);
                reject(new Error(`unluac Error: ${this.stripAnsi(stderr).slice(-800)}`));
            });
        });
    }
}

module.exports = { PythonBridge };
