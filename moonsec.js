const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve, reject) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const unluacPath = path.join(__dirname, "unluac.jar");

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { timeout: 120000 });
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });

            proc.on("close", (code) => {
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return reject(new Error(`Moonsec DLL Error (${code}): ${stderr.slice(-800)}`));
                }

                const javaProc = spawn("java", ["-jar", unluacPath, luacFile], { timeout: 120000 });
                let out = "", err = "";
                javaProc.stdout.on("data", (data) => { out += data.toString(); });
                javaProc.stderr.on("data", (data) => { err += data.toString(); });

                javaProc.on("close", (jCode) => {
                    if (jCode === 0 && out.length > 20) {
                        resolve(out);
                    } else {
                        reject(new Error(`Unluac Error (${jCode}): ${err.slice(-800)}`));
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
