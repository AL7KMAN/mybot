const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve, reject) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const unluacPath = "/root/.cargo/bin/unluac-cli";

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { 
                timeout: 60000, 
                killSignal: 'SIGKILL' 
            });
            
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            
            proc.on("error", (err) => {
                reject(new Error(`Failed to start Moonsec: ${err.message}`));
            });

            proc.on("close", (code) => {
                if (!fs.existsSync(luacFile)) {
                    return reject(new Error(`Moonsec failed to extract bytecode.`));
                }

                const unluacProc = spawn(unluacPath, [luacFile], { 
                    timeout: 60000, 
                    killSignal: 'SIGKILL' 
                });
                
                let out = "", err = "";
                unluacProc.stdout.on("data", (data) => { out += data.toString(); });
                unluacProc.stderr.on("data", (data) => { err += data.toString(); });

                unluacProc.on("error", (jErr) => {
                    const luacData = fs.readFileSync(luacFile);
                    resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                });

                unluacProc.on("close", (jCode) => {
                    if (out.length > 20) {
                        resolve(out);
                    } else {
                        // إذا فشلت الأداة، نجرب نطلع أوامر الآلة كنص مقروء
                        const disasmProc = spawn("luac5.1", ["-l", "-l", luacFile]);
                        let disasmOut = "", disasmErr = "";
                        disasmProc.stdout.on("data", (d) => { disasmOut += d.toString(); });
                        disasmProc.stderr.on("data", (d) => { disasmErr += d.toString(); });

                        disasmProc.on("close", () => {
                            if (disasmOut.length > 20) {
                                resolve("=== PROTECTED BYTECODE DISASSEMBLY ===\n\n" + disasmOut);
                            } else {
                                const luacData = fs.readFileSync(luacFile);
                                resolve("BYTECODE_HEX:" + luacData.toString("hex"));
                            }
                        });
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
