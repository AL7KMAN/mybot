const fs = require("fs");
const path = require("path");
const { PythonBridge } = require("./tools.js");
const { Deobfuscator } = require("./core.js");

class Pipeline {
    static isCleanCode(code) {
        if (!code || typeof code !== "string") return false;
        if (code.includes("UNPACK CALLED")) return false;
        if (code.includes("CAPTURED CHUNK")) return false;
        if (code.includes("ACCESSED (NIL)")) return false;
        if (code.includes("local Constants =")) return false;
        if (code.startsWith("BYTECODE_HEX:")) return false;
        if (code.includes("[SANDBOX_ERROR]")) return false;
        
        const signals = ["game:GetService", "workspace", "Instance.new", "local function", "require("];
        let matches = 0;
        for (const sig of signals) {
            if (code.includes(sig)) matches++;
        }
        return matches >= 1;
    }

    static beautify(code) {
        const lines = code.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        let indent = 0;
        const out = [];
        for (const line of lines) {
            if (/^(end|else|elseif|until|\)|\})/i.test(line)) indent = Math.max(0, indent - 1);
            out.push("  ".repeat(indent) + line);
            if (/(then|do|function|repeat|else|elseif|\{|\()$/i.test(line) && !/^(else|elseif)/i.test(line)) indent++;
        }
        return out.join("\n");
    }

    static async runWeAreDevsChain(originalCode, tempDir) {
        let currentCode = originalCode;
        let finalCode = null;
        let usedTools = [];
        let isBytecode = false;

        const tools = ["wearedevs", "prometheus"];

        for (const tool of tools) {
            try {
                const tempIn = path.join(tempDir, `wd_${Date.now()}_${tool}.lua`);
                fs.writeFileSync(tempIn, currentCode);
                
                let result = await PythonBridge.run(tool, tempIn);
                
                try { fs.unlinkSync(tempIn); } catch (e) {}

                if (result.startsWith("BYTECODE_HEX:")) {
                    isBytecode = true;
                    finalCode = result;
                    usedTools.push(tool);
                    break;
                }

                if (this.isCleanCode(result)) {
                    currentCode = result;
                    finalCode = result;
                    usedTools.push(tool);
                    break;
                } else {
                    currentCode = result;
                    usedTools.push(tool);
                }
            } catch (e) {
                continue;
            }
        }

        if (isBytecode) {
            try {
                const luacBuffer = Buffer.from(finalCode.replace("BYTECODE_HEX:", ""), "hex");
                const luacPath = path.join(tempDir, `wd_${Date.now()}.luac`);
                fs.writeFileSync(luacPath, luacBuffer);
                
                const unluacRes = await PythonBridge.runUnluac(luacPath);
                try { fs.unlinkSync(luacPath); } catch (e) {}
                
                if (unluacRes) {
                    finalCode = unluacRes;
                    usedTools.push("unluac");
                    isBytecode = false;
                }
            } catch (e) {}
        }

        if (!finalCode) finalCode = currentCode;

        try {
            const deobf = new Deobfuscator(finalCode, { beautify: false });
            await deobf.run();
            finalCode = deobf.code;
            usedTools.push("JS-Engine");
        } catch (e) {}

        finalCode = this.beautify(finalCode);

        return { code: finalCode, tools: usedTools, isBytecode: false };
    }
}

module.exports = { Pipeline };
