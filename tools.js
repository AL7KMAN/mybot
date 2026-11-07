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
                const deobfPath = inputFile + ".deobf.lua";
                const cmd = "node";
                const args = [
                    path.join(__dirname, "prometheus-deobf", "bin", "pdeobf.js"),
                    inputFile,
                    "-o", deobfPath
                ];
                const proc = spawn(cmd, args, { timeout: 120000 });

                let stderr = "";
                proc.stderr.on("data", (data) => { stderr += data.toString(); });

                proc.on("close", (code) => {
                    if (fs.existsSync(deobfPath) && fs.statSync(deobfPath).size > 50) {
                        return resolve(fs.readFileSync(deobfPath, "utf-8"));
                    }
                    if (code !== 0) {
                        return reject(new Error(`Prometheus Node.js Error (${code}): ${stderr.slice(-1500)}`));
                    }
                    reject(new Error("Prometheus Node.js finished but no output file was created."));
                });
                return;
            }

            if (tool === "moonsec") {
                return reject(new Error("Moonsec is now handled by MoonsecBridge."));
            }

            let cmd, args, options;
            if (tool === "prometheus") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/prometheus/pol.py"), inputFile];
                options = { timeout: 60000 };
            } else {
                return reject(new Error(`Unknown tool: ${tool}`));
            }
            
            const proc = spawn(cmd, args, options);
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(this.stripAnsi(stdout) || "Success");
                } else {
                    reject(new Error(`Tool Error (${code}): ${this.stripAnsi(stderr).slice(-1500)}`));
                }
            });
        });
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath], { timeout: 60000 });
            let stdout = "", stderr = "";
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
