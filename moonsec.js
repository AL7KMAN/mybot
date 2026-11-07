hereconst { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { LuaSandbox } = require("./sandbox.js");

class MoonsecBridge {
    static async run(inputFile) {
        let sandboxResult = { captures: [], logs: "", error: null };
        try {
            const originalCode = fs.readFileSync(inputFile, "utf-8");
            sandboxResult = await LuaSandbox.run(originalCode);
        } catch(e) {}

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
                let out = "", err = "";
                unluacProc.stdout.on("data", (d) => { out += d.toString(); });
                unluacProc.stderr.on("data", (d) => { err += d.toString(); });

                unluacProc.on("error", () => {
                    resolve({ isBytecode: true, buffer: fs.readFileSync(luacFile), logs: sandboxResult.logs });
                });

                unluacProc.on("close", (jCode) => {
                    if (jCode === 0 && out.length > 20) {
                        resolve({ text: out });
                    } else {
                        resolve({ isBytecode: true, buffer: fs.readFileSync(luacFile), logs: sandboxResult.logs });
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
