const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve, reject) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const unluauPath = path.join(__dirname, "unluau-bin/Unluau.CLI");

            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { 
                timeout: 60000, 
                killSignal: 'SIGKILL' 
            });
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });

            proc.on("close", (code) => {
                if (code === null) {
                    return reject(new Error(`Moonsec DLL timed out and was killed. The script is too complex or has an infinite loop.`));
                }
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return reject(new Error(`Moonsec DLL Error (${code}): ${stderr.slice(-800)}`));
                }

                const unluauProc = spawn(unluauPath, [luacFile, "-o", inputFile + ".deobf.lua"], { 
                    timeout: 60000, 
                    killSignal: 'SIGKILL' 
                });
                let out = "", err = "";
                unluauProc.stdout.on("data", (data) => { out += data.toString(); });
                unluauProc.stderr.on("data", (data) => { err += data.toString(); });

                unluauProc.on("close", (jCode) => {
                    if (jCode === null) {
                        return reject(new Error(`Unluau timed out and was killed.`));
                    }
                    const resultPath = inputFile + ".deobf.lua";
                    if (jCode === 0 && fs.existsSync(resultPath)) {
                        resolve(fs.readFileSync(resultPath, "utf-8"));
                    } else {
                        reject(new Error(`Unluau Error (${jCode}): ${err.slice(-800)}`));
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
