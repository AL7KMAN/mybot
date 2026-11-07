const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '');
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
                ], { timeout: 300000, cwd: dir, killSignal: 'SIGKILL' });

                let s1out = "";
                let s1err = "";
                step1.stdout.on("data", (d) => s1out += d.toString());
                step1.stderr.on("data", (d) => s1err += d.toString());

                step1.on("close", (c1) => {
                    if (!fs.existsSync(reportPath)) {
                        return reject(new Error(`Dumper failed. No report.txt generated.`));
                    }

                    const traceToLua = path.join(luaDir, "trace_to_lua.py");
                    if (!fs.existsSync(traceToLua)) {
                        return reject(new Error("trace_to_lua.py missing"));
                    }

                    const step2 = spawn("/opt/venv/bin/python3", [
                        traceToLua,
                        reportPath
                    ], { timeout: 120000, cwd: dir, killSignal: 'SIGKILL' });

                    let s2out = "";
                    let s2err = "";
                    step2.stdout.on("data", (d) => s2out += d.toString());
                    step2.stderr.on("data", (d) => s2err += d.toString());

                    step2.on("close", (c2) => {
                        // الفحص السحري: إذا طلع الملف النظيف نقرأه فوراً
                        const deobfPath = inputFile + ".deobf.lua";
                        if (fs.existsSync(deobfPath) && fs.statSync(deobfPath).size > 50) {
                            return resolve(fs.readFileSync(deobfPath, "utf-8"));
                        }
                        resolve(this.stripAnsi(s2out));
                    });
                });
                return;
            }
            
            let cmd, args;
            if (tool === "prometheus") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/prometheus/pol.py"), inputFile];
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
                        resolve(this.stripAnsi(stdout) || "Success");
                    }
                } else {
                    reject(new Error(`Tool Error (${code}): ${stderr.slice(0, 1500)}`));
                }
            });
        });
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath], { timeout: 60000 });
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("close", (code) => {
                if (code === 0) resolve(stdout);
                else reject(new Error(`unluac Error: ${stderr}`));
            });
        });
    }

    static async runLua51(inputFile, wrapperPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("lua5.1", [wrapperPath, inputFile], { timeout: 25000 });
            let out = "", err = "";
            proc.stdout.on("data", d => out += d.toString());
            proc.stderr.on("data", d => err += d.toString());
            proc.on("close", (code) => {
                const captures = [];
                const re = /\[CAPTURE:([A-Z]+)\]\n([\s\S]*?)\n\[\/CAPTURE\]/g;
                let m;
                while ((m = re.exec(out)) !== null) captures.push({ kind: m[1], payload: m[2] });
                const httpGets = [];
                const reH = /\[HTTPGET\] (.+)/g;
                while ((m = reH.exec(out)) !== null) httpGets.push(m[1].trim());
                const errs = [];
                const reE = /\[EXEC_ERROR\] (.+)/g;
                while ((m = reE.exec(out)) !== null) errs.push(m[1].trim());
                
                if (captures.length > 0) {
                    const best = captures.find(c => c.kind === "LOADSTRING" && c.payload.length > 100) || captures[0];
                    resolve({ captured: best, all: captures, httpGets, errors: errs, raw: out });
                } else {
                    resolve({ captured: null, all: [], httpGets, errors: errs, raw: out });
                }
            });
        });
    }
}

module.exports = { PythonBridge };
