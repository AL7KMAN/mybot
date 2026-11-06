const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class PythonBridge {
    static stripAnsi(str) {
        return str.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '');
    }

    static async run(tool, inputFile) {
        return new Promise((resolve, reject) => {
            let cmd, args, options;
            
            if (tool === "prometheus") {
                cmd = "/opt/venv/bin/python3";
                args = [path.join(__dirname, "tools/prometheus/pol.py"), inputFile];
                options = { timeout: 60000 };
            } else if (tool === "wearedevs") {
                cmd = "/opt/venv/bin/python3";
                // لا نضيف أي خيارات تخرب الشغل، نعطيها بيئة Lua الصحيحة
                args = [path.join(__dirname, "tools/wearedevs/deobfuscator.py"), inputFile];
                options = { 
                    timeout: 60000, // دقيقة واحدة كافية جداً، إذا طولت معناها علقت
                    killSignal: 'SIGKILL',
                    env: { ...process.env, LUA51_EXECUTABLE: "/app/tools/wearedevs/lua_linux/lua5.1" }
                };
            } else if (tool === "moonsec") {
                cmd = "dotnet";
                args = [path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll"), "-dev", "-i", inputFile, "-o", inputFile + ".luac"];
                options = { timeout: 60000 };
            } else {
                return reject(new Error("Unknown tool"));
            }
            
            const proc = spawn(cmd, args, options);
            let stdout = "";
            let stderr = "";
            
            proc.stdout.on("data", (data) => { stdout += data.toString(); });
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("close", (code) => {
                // 🔴 الثغرة كانت هنا: نفحص أول شي إذا الأداة حفظت الملف النظيف بنفسها!
                const deobfPath = inputFile + ".deobf.lua";
                if (fs.existsSync(deobfPath) && fs.statSync(deobfPath).size > 50) {
                    return resolve(fs.readFileSync(deobfPath, "utf-8"));
                }

                if (code === 0 || fs.existsSync(inputFile + ".report.txt")) {
                    if (tool === "moonsec") {
                        try {
                            const luacData = fs.readFileSync(inputFile + ".luac");
                            resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                        } catch (e) {
                            reject(new Error("Failed to read Moonsec output"));
                        }
                    } else if (tool === "wearedevs") {
                        const traceScript = path.join(__dirname, "tools/wearedevs/trace_to_lua.py");
                        const reportPath = inputFile + ".report.txt";
                        
                        const step2 = spawn("/opt/venv/bin/python3", [traceScript, reportPath], { timeout: 60000 });
                        let out2 = "", err2 = "";
                        step2.stdout.on("data", (d) => out2 += d.toString());
                        step2.stderr.on("data", (d) => err2 += d.toString());
                        
                        step2.on("close", (c2) => {
                            // نفحص الملف النظيف مرة ثانية بعد الأداة الثانية
                            if (fs.existsSync(deobfPath) && fs.statSync(deobfPath).size > 50) {
                                return resolve(fs.readFileSync(deobfPath, "utf-8"));
                            }
                            if (c2 === 0) resolve(this.stripAnsi(out2));
                            else reject(new Error(`trace_to_lua Error (${c2}): ${err2}`));
                        });
                    } else {
                        resolve(stdout || "Tool finished, but no output file found.");
                    }
                } else {
                    reject(new Error(`Tool Error (${code}): ${stderr.slice(0, 1500)}`));
                }
            });
        });
    }
    // باقي الدوال (runUnluac و runLua51) نتركها كما هي...
}
