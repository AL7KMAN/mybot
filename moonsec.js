const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

class MoonsecBridge {
    static async run(inputFile) {
        return new Promise((resolve) => {
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
                resolve({ error: `Failed to start Moonsec DLL: ${err.message}` });
            });

            proc.on("close", (code) => {
                if (code !== 0 || !fs.existsSync(luacFile)) {
                    return resolve({ error: `Moonsec DLL failed: ${stderr.slice(-500)}` });
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
                    resolve({ isBytecode: true, buffer: luacData });
                });

                unluacProc.on("close", (jCode) => {
                    if (jCode === 0 && out.length > 50) {
                        let finalCode = out;
                        finalCode = finalCode.replace(/-- PHASE_BOUNDARY:INIT\s*/g, '');
                        finalCode = finalCode.replace(/-- \[\d+\]\s*/g, '');
                        finalCode = finalCode.replace(/local function =/g, 'local _func =');
                        finalCode = finalCode.replace(/local element = ;/g, 'local element = 0;');
                        finalCode = finalCode.replace(/\n{3,}/g, '\n\n');

                        const urls = finalCode.match(/https?:\/\/[^\s"'`]+/g) || [];
                        const uniqueUrls = [...new Set(urls)].filter(u => u.length > 10 && u.length < 250);

                        resolve({ text: finalCode, urls: uniqueUrls });
                    } else {
                        const luacData = fs.readFileSync(luacFile);
                        resolve({ isBytecode: true, buffer: luacData });
                    }
                });
            });
        });
    }
}

module.exports = { MoonsecBridge };
