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
                    const errMsg = this.stripAnsi(stderr || "Unknown error").slice(0, 1500);
                    reject(new Error(`Tool Error (${code}): ${errMsg}`));
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
                if (code === 0) {
                    resolve(stdout);
                } else {
                    reject(new Error(`unluac Error: ${stderr}`));
                }
            });
        });
    }
}

module.exports = { PythonBridge };
