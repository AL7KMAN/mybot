const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const unluacPath = "/root/.cargo/bin/unluac-cli";

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { timeout: 60000, killSignal: 'SIGKILL' });
            let stderr = "";
            proc.stderr.on("data", (d) => { stderr += d.toString(); });
            
            proc.on("error", () => resolve({ error: "DLL Execution Error" }));
            
            proc.on("close", (code) => {
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return resolve({ error: "Moonsec DLL failed to extract bytecode." });
                }

                const unluacProc = spawn(unluacPath, [luacFile], { timeout: 60000, killSignal: 'SIGKILL' });
                let out = "";
                unluacProc.stdout.on("data", (d) => { out += d.toString(); });

                unluacProc.on("error", () => {
                    resolve({ isBytecode: true, buffer: fs.readFileSync(luacFile) });
                });

                unluacProc.on("close", (jCode) => {
                    if (jCode === 0 && out.length > 20) {
                        resolve({ text: out });
                    } else {
                        resolve({ isBytecode: true, buffer: fs.readFileSync(luacFile) });
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
