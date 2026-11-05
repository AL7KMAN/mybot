const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '');
    }

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
            proc.stdout.on("data", (d) => { stdout += d.toString(); });
            proc.stderr.on("data", (d) => { stderr += d.toString(); });
            proc.on("close", (code) => {
                if (code === 0) {
                    if (tool === "moonsec") {
                        try {
                            const data = fs.readFileSync(inputFile + ".luac");
                            resolve("BYTECODE_HEX:" + data.toString("hex"));
                        } catch (e) {
                            reject(new Error("Moonsec output not found"));
                        }
                    } else {
                        const outputs = ["output.lua", "dump.lua", "deobfuscated.lua", "reconstructed.lua"];
                        for (const o of outputs) {
                            const p = path.join(path.dirname(inputFile), o);
                            if (fs.existsSync(p)) return resolve(fs.readFileSync(p, "utf-8"));
                        }
                        resolve(this.cleanTrace(stdout));
                    }
                } else {
                    reject(new Error(`Tool ${tool} exited ${code}: ${stderr.slice(0, 1000)}`));
                }
            });
        });
    }

    static cleanTrace(str) {
        return str.split('\n').filter(l => {
            const t = l.trim();
            if (t.startsWith('Processing ') || t.startsWith('Executing ')) return false;
            if (t.startsWith('UNPACK CALLED') || t.startsWith('CAPTURED CHUNK')) return false;
            if (t.startsWith('ACCESSED (NIL)')) return false;
            if (t.startsWith('local Constants =') || t.startsWith('{ [1] =')) return false;
            if (t.startsWith('Traceback') || t.includes('Error:') && t.includes('File "')) return false;
            return true;
        }).join('\n').trim();
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath], { timeout: 60000 });
            let out = "", err = "";
            proc.stdout.on("data", d => out += d.toString());
            proc.stderr.on("data", d => err += d.toString());
            proc.on("close", c => c === 0 ? resolve(out) : reject(new Error(err)));
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
                while ((m = re.exec(out)) !== null) {
                    captures.push({ kind: m[1], payload: m[2] });
                }
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
                    resolve({ captured: null, all: [], httpGets, errors: errs, raw: out, code });
                }
            });
        });
    }
}

module.exports = { PythonBridge };
