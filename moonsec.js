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
                if (code === null) {
                    return reject(new Error("Moonsec timed out."));
                }
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return reject(new Error(`Moonsec failed: ${stderr.slice(-500)}`));
                }

                const unluacProc = spawn(unluacPath, [luacFile], { 
                    timeout: 60000, 
                    killSignal: 'SIGKILL' 
                });
                
                let out = "", err = "";
                unluacProc.stdout.on("data", (data) => { out += data.toString(); });
                unluacProc.stderr.on("data", (data) => { err += data.toString(); });

                unluacProc.on("error", (jErr) => {
                    reject(new Error(`Failed to start unluac-rs: ${jErr.message}`));
                });

                unluacProc.on("close", (jCode) => {
                    if (jCode === null) {
                        return reject(new Error("Unluac-rs timed out."));
                    }
                    if (jCode === 0 && out.length > 20) {
                        resolve(out);
                    } else {
                        reject(new Error(`Unluac-rs failed to decompile this script.`));
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
