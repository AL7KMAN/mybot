const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '');
    }

    static cleanTraceOutput(str) {
        const lines = str.split('\n');
        const cleanLines = lines.filter(line => {
            const l = line.trim();
            if (l.startsWith('Processing ')) return false;
            if (l.startsWith('Executing ')) return false;
            if (l.startsWith('UNPACK CALLED')) return false;
            if (l.startsWith('CAPTURED CHUNK')) return false;
            if (l.startsWith('ACCESSED (NIL)')) return false;
            if (l.startsWith('local Constants =')) return false;
            if (l.startsWith('{ [1] =')) return false;
            if (l.startsWith('File "') && l.includes('", line ')) return false;
            if (l.startsWith('Traceback')) return false;
            if (l.includes('Error:') && l.includes('File "')) return false;
            return true;
        });
        return cleanLines.join('\n').trim();
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
                        const possibleOutputs = ["output.lua", "dump.lua", "deobfuscated.lua"];
                        let foundFile = null;
                        for (const outName of possibleOutputs) {
                            const outPath = path.join(path.dirname(inputFile), outName);
                            if (fs.existsSync(outPath)) {
                                foundFile = fs.readFileSync(outPath, "utf-8");
                                break;
                            }
                        }
                        
                        if (foundFile) {
                            resolve(foundFile);
                        } else {
                            const cleaned = this.cleanTraceOutput(this.stripAnsi(stdout));
                            resolve(cleaned || "Deobfuscation finished, but no code was extracted. The tool may be incompatible with this specific script version.");
                        }
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
