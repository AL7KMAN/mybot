const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static async run(tool, inputFile) {
        return new Promise((resolve, reject) => {
            let cmd, args;
            if (tool === "wearedevs") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile];
            } else if (tool === "prometheus") {
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
                    } else if (tool === "wearedevs") {
                        // البوت الثاني كان يحفظ اللوق في report.txt ثم يشغل trace_to_lua
                        const dir = path.dirname(inputFile);
                        const reportPath = path.join(dir, "report.txt");
                        fs.writeFileSync(reportPath, stdout);

                        const traceToLuaPath = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                        if (fs.existsSync(traceToLuaPath)) {
                            const convertProc = spawn("/opt/venv/bin/python3", [traceToLuaPath, reportPath], { timeout: 60000 });
                            let finalCode = "";
                            convertProc.stdout.on("data", (d) => { finalCode += d.toString(); });
                            convertProc.on("close", (c) => {
                                if (c === 0 && finalCode.length > 100) {
                                    resolve(finalCode);
                                } else {
                                    // إذا فشل التحويل، نرجع الكود المباشر
                                    resolve(stdout); 
                                }
                            });
                        } else {
                            // إذا كان الملف ينزل الكود مباشرة بدون trace_to_lua
                            resolve(stdout);
                        }
                    } else {
                        resolve(stdout);
                    }
                } else {
                    reject(new Error(`Tool Error (${code}): ${stderr.slice(0, 1500)}`));
                }
            });
        });
    }
}

module.exports = { PythonBridge };
