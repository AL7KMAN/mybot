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
            
            // 🔴 هنا التعديل الوحيد: حذفنا التايم أوت نهائياً عشان نعطي الأداة راحتها
            const proc = spawn(cmd, args);
            let stdout = "";
            let stderr = "";
            
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("close", (code) => {
                // 🔴 فحص بسيط: إذا أنتجت الأداة الملف النظيف، نقرأه فوراً
                const deobfPath = inputFile + ".deobf.lua";
                if (fs.existsSync(deobfPath) && fs.statSync(deobfPath).size > 50) {
                    return resolve(fs.readFileSync(deobfPath, "utf-8"));
                }

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
                    const errMsg = this.stripAnsi(stderr || "Unknown error").slice(0, 1500);
                    reject(new Error(`Tool Error (${code}): ${errMsg}`));
                }
            });
        });
    }

    static async runUnluac(luacPath) {
        return new Promise((resolve, reject) => {
            // حذفنا التايم أوت هنا بعد
            const proc = spawn("java", ["-jar", path.join(__dirname, "unluac.jar"), luacPath]);
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("close", (code) => {
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`unluac Error: ${stderr}`));
                }
            });
        });
    }

    static async runLua51(inputFile, wrapperPath) {
        return new Promise((resolve, reject) => {
            // حذفنا التايم أوت هنا بعد
            const proc = spawn("lua5.1", [wrapperPath, inputFile]);
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
                    resolve({ captured: null, all: [], httpGets, errors: errs, raw: out });
                }
            });
        });
    }
}

module.exports = { PythonBridge };
