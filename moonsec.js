const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const luaparse = require("luaparse");

class LuaContextRenamer {
    static process(luaCode) {
        const safeTextMap = new Map();
        let placeholderCounter = 0;

        let sanitizedCode = luaCode.replace(/(["'])((?:\\[\s\S]|[^\\])*?)\1/g, (match, quote, content) => {
            if (/[\uFFFD\uFFFE\uFFFF]/.test(content) || content.split('').some(c => c.charCodeAt(0) > 127)) {
                const placeholder = `__LM7H_SAFE_STRING_${placeholderCounter++}__`;
                safeTextMap.set(placeholder, content);
                return `${quote}${placeholder}${quote}`;
            }
            return match;
        });

        try {
            const ast = luaparse.parse(sanitizedCode, { 
                locations: false, 
                ranges: false, 
                scope: true, 
                luaVersion: '5.1' 
            });

            const globalScopeUsedNames = new Set();

            const getUniqueName = (baseName, scopeStack) => {
                let cleanBase = baseName.replace(/[^a-zA-Z0-9_]/g, "");
                if (!cleanBase) cleanBase = "Var";
                let finalName = cleanBase;
                let counter = 1;
                while (globalScopeUsedNames.has(finalName)) {
                    finalName = `${cleanBase}_${counter++}`;
                }
                globalScopeUsedNames.add(finalName);
                return finalName;
            };

            const traverse = (node, parentScope) => {
                if (!node || typeof node !== 'object') return;

                if (node.type === 'LocalStatement' && node.init && node.init.length > 0) {
                    node.init.forEach((initNode, idx) => {
                        const target = node.variables[idx];
                        if (target && target.type === 'Identifier' && /^[Lr][0-9]+_[0-9]+$|^[Lr][0-9]+$/.test(target.name)) {
                            let baseName = null;
                            if (initNode.type === 'CallExpression' && initNode.base) {
                                const base = initNode.base;
                                if (base.type === 'MemberExpression' && base.indexer === ':' && base.identifier && base.identifier.name === 'GetService') {
                                    if (initNode.arguments[0] && initNode.arguments[0].type === 'StringLiteral') {
                                        baseName = initNode.arguments[0].raw.replace(/["']/g, "") + "_Service";
                                    }
                                } else if (base.type === 'MemberExpression' && base.indexer === '.' && base.base && base.base.type === 'Identifier' && base.base.name === 'Instance' && base.identifier.name === 'new') {
                                    if (initNode.arguments[0] && initNode.arguments[0].type === 'StringLiteral') {
                                        baseName = initNode.arguments[0].raw.replace(/["']/g, "") + "_Instance";
                                    }
                                } else if (base.type === 'Identifier' && base.name === 'tick') {
                                    baseName = "Tick_Time";
                                } else if (base.type === 'Identifier' && base.name === 'typeof') {
                                    baseName = "TypeResult";
                                }
                            } else if (initNode.type === 'TableConstructor') {
                                baseName = "ConfigTable";
                            } else if (initNode.type === 'FunctionDeclaration') {
                                baseName = "CallbackFunc";
                            }
                            if (baseName) target.name = getUniqueName(baseName, parentScope);
                        }
                    });
                }

                if (node.type === 'LocalFunctionStatement' && node.identifier && /^[Lr][0-9]+_[0-9]+$|^[Lr][0-9]+$/.test(node.identifier.name)) {
                    node.identifier.name = getUniqueName("LocalFunc", parentScope);
                }

                if (node.type === 'FunctionDeclaration' && node.parameters) {
                    node.parameters.forEach((param, pIdx) => {
                        if (param.type === 'Identifier' && /^[Lr][0-9]+_[0-9]+$|^[Lr][0-9]+$/.test(param.name)) {
                            param.name = getUniqueName(`Param_${pIdx}`, parentScope);
                        }
                    });
                }

                if (node.type === 'ForGenericStatement' && node.variables) {
                    node.variables.forEach((v, vIdx) => {
                        if (v.type === 'Identifier' && /^[Lr][0-9]+_[0-9]+$|^[Lr][0-9]+$/.test(v.name)) {
                            v.name = getUniqueName(vIdx === 0 ? "LoopKey" : "LoopValue", parentScope);
                        }
                    });
                }

                if (node.type === 'ForNumericStatement' && node.variable) {
                    if (node.variable.type === 'Identifier' && /^[Lr][0-9]+_[0-9]+$|^[Lr][0-9]+$/.test(node.variable.name)) {
                        node.variable.name = getUniqueName("LoopIndex", parentScope);
                    }
                }

                for (let key in node) {
                    if (node[key] && typeof node[key] === 'object') {
                        if (Array.isArray(node[key])) {
                            node[key].forEach(child => traverse(child, parentScope));
                        } else if (key !== 'loc') {
                            traverse(node[key], parentScope);
                        }
                    }
                }
            };

            traverse(ast, []);

            let outputCode = LuaContextRenamer.generate(ast, 0);

            safeTextMap.forEach((originalContent, placeholder) => {
                outputCode = outputCode.split(placeholder).join(originalContent);
            });

            return outputCode;

        } catch (error) {
            return luaCode;
        }
    }

    static generate(node, indent) {
        const ind = "    ".repeat(indent);
        
        if (!node) return '';
        
        switch (node.type) {
            case 'Chunk':
                return node.body.map(stmt => LuaContextRenamer.generate(stmt, indent)).join('\n');
            case 'LocalStatement':
                return ind + 'local ' + node.variables.map(v => v.name).join(', ') + (node.init.length ? ' = ' + node.init.map(e => LuaContextRenamer.generateExpression(e)).join(', ') : '');
            case 'LocalFunctionStatement':
                return ind + 'local function ' + node.identifier.name + '(' + node.parameters.map(p => p.name || '...').join(', ') + ')\n' + node.body.map(stmt => LuaContextRenamer.generate(stmt, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'FunctionDeclaration':
                return ind + 'function(' + node.parameters.map(p => p.name || '...').join(', ') + ')\n' + node.body.map(stmt => LuaContextRenamer.generate(stmt, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'AssignmentStatement':
                return ind + node.variables.map(v => LuaContextRenamer.generateExpression(v)).join(', ') + ' = ' + node.init.map(e => LuaContextRenamer.generateExpression(e)).join(', ');
            case 'CallStatement':
                return ind + LuaContextRenamer.generateExpression(node.expression);
            case 'IfStatement':
                let istr = ind + 'if ' + LuaContextRenamer.generateExpression(node.clauses[0].condition) + ' then\n' + node.clauses[0].body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n');
                for (let i = 1; i < node.clauses.length; i++) {
                    istr += '\n' + ind + 'elseif ' + LuaContextRenamer.generateExpression(node.clauses[i].condition) + ' then\n' + node.clauses[i].body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n');
                }
                if (node.clauses[0].elseBody) {
                    istr += '\n' + ind + 'else\n' + node.clauses[0].elseBody.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n');
                }
                return istr + '\n' + ind + 'end';
            case 'WhileStatement':
                return ind + 'while ' + LuaContextRenamer.generateExpression(node.condition) + ' do\n' + node.body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'RepeatStatement':
                return ind + 'repeat\n' + node.body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n') + '\n' + ind + 'until ' + LuaContextRenamer.generateExpression(node.condition);
            case 'ForNumericStatement':
                return ind + 'for ' + node.variable.name + ' = ' + LuaContextRenamer.generateExpression(node.start) + ', ' + LuaContextRenamer.generateExpression(node.end) + (node.step ? ', ' + LuaContextRenamer.generateExpression(node.step) : '') + ' do\n' + node.body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'ForGenericStatement':
                return ind + 'for ' + node.variables.map(v => v.name).join(', ') + ' in ' + node.iterators.map(e => LuaContextRenamer.generateExpression(e)).join(', ') + ' do\n' + node.body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'DoStatement':
                return ind + 'do\n' + node.body.map(s => LuaContextRenamer.generate(s, indent + 1)).join('\n') + '\n' + ind + 'end';
            case 'ReturnStatement':
                return ind + 'return' + (node.arguments.length ? ' ' + node.arguments.map(e => LuaContextRenamer.generateExpression(e)).join(', ') : '');
            case 'BreakStatement':
                return ind + 'break';
            case 'Identifier':
                return node.name;
            case 'NilLiteral':
                return 'nil';
            case 'BooleanLiteral':
                return node.value.toString();
            case 'NumericLiteral':
                return node.value.toString();
            case 'StringLiteral':
                return node.raw;
            case 'VarargLiteral':
                return '...';
            case 'TableConstructor':
                return '{' + node.fields.map(f => LuaContextRenamer.generateTableField(f)).join(', ') + '}';
            case 'BinaryExpression':
                return '(' + LuaContextRenamer.generateExpression(node.left) + ' ' + node.operator + ' ' + LuaContextRenamer.generateExpression(node.right) + ')';
            case 'UnaryExpression':
                return node.operator + (node.operator === 'not' ? ' ' : '') + LuaContextRenamer.generateExpression(node.argument);
            case 'MemberExpression':
                return LuaContextRenamer.generateExpression(node.base) + node.indexer + LuaContextRenamer.generateExpression(node.identifier);
            case 'IndexExpression':
                return LuaContextRenamer.generateExpression(node.base) + '[' + LuaContextRenamer.generateExpression(node.index) + ']';
            case 'CallExpression':
                return LuaContextRenamer.generateExpression(node.base) + '(' + node.arguments.map(a => LuaContextRenamer.generateExpression(a)).join(', ') + ')';
            case 'TableKey':
                return '[' + LuaContextRenamer.generateExpression(node.key) + '] = ' + LuaContextRenamer.generateExpression(node.value);
            case 'TableKeyString':
                return LuaContextRenamer.generateExpression(node.key) + ' = ' + LuaContextRenamer.generateExpression(node.value);
            case 'TableValue':
                return LuaContextRenamer.generateExpression(node.value);
            default:
                return '';
        }
    }

    static generateExpression(node) {
        if (!node) return '';
        return LuaContextRenamer.generate(node, 0).trim();
    }

    static generateTableField(field) {
        if (field.type === 'TableKey') return '[' + LuaContextRenamer.generateExpression(field.key) + '] = ' + LuaContextRenamer.generateExpression(field.value);
        if (field.type === 'TableKeyString') return LuaContextRenamer.generateExpression(field.key) + ' = ' + LuaContextRenamer.generateExpression(field.value);
        return LuaContextRenamer.generateExpression(field.value);
    }
}

class MoonsecBridge {
    static async run(inputFile) {
        const dllResult = await MoonsecBridge.tryDll(inputFile);
        if (dllResult.success) {
            const decompileResult = await MoonsecBridge.tryDecompress(dllResult.luacFile);
            if (!decompileResult.isBytecode) {
                let code = decompileResult.text;
                code = MoonsecBridge.cleanArtifacts(code);
                code = LuaContextRenamer.process(code);
                return { text: code, decompiler: decompileResult.decompiler };
            }
            return { error: `Pipeline failed. Reason: ${decompileResult.error}` };
        }
        return { error: `DLL failed: ${dllResult.error}` };
    }
    
    static async tryDll(inputFile) {
        return new Promise((resolve) => {
            const luacFile = inputFile + ".luac";
            const dllPath = path.join(__dirname, "moonsec_bin/MoonsecDeobfuscator.dll");
            const proc = spawn("dotnet", [dllPath, "-dev", "-i", inputFile, "-o", luacFile], { timeout: 180000, killSignal: 'SIGKILL' });
            let stderr = "";
            proc.stderr.on("data", (data) => { stderr += data.toString(); });
            proc.on("error", (err) => resolve({ success: false, error: `spawn failed: ${err.message}` }));
            proc.on("close", (code, signal) => {
                if (fs.existsSync(luacFile) && fs.statSync(luacFile).size > 10) return resolve({ success: true, luacFile });
                resolve({ success: false, error: `DLL exit ${code}: ${stderr.slice(-300)}` });
            });
        });
    }

    static async tryDecompress(luacFile) {
        const unluacRsPath = "/root/.cargo/bin/unluac-cli";
        const rsResult = await MoonsecBridge.tryRun(unluacRsPath, ["-i", luacFile], 60000);
        if (rsResult.success && rsResult.out.length > 50) return { text: rsResult.out, decompiler: "unluac-rs (Rust)" };
        
        const unluacJavaPath = path.join(__dirname, "unluac.jar");
        const javaResult = await MoonsecBridge.tryRun("java", ["-jar", unluacJavaPath, luacFile], 60000);
        if (javaResult.success && javaResult.out.length > 50) return { text: javaResult.out, decompiler: "unluac (Java)" };
        
        return { isBytecode: true, error: `Rust & Java failed` };
    }

    static cleanArtifacts(code) {
        return code
            .replace(/^-- file:.*$/gm, '')
            .replace(/^-- dialect:.*$/gm, '')
            .replace(/^-- encoding:.*$/gm, '')
            .replace(/^-- decompiled by.*$/gm, '')
            .replace(/ -- proto#\d+.*$/gm, '')
            .replace(/-- PHASE_BOUNDARY:\w+\s*/g, '')
            .replace(/-- \[\d+\]\s*/g, '')
            .replace(/\[POL\] - /g, '-- ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    static tryRun(cmd, args, timeoutMs) {
        return new Promise((resolve) => {
            try {
                const proc = spawn(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL' });
                let out = "", err = "";
                proc.stdout.on("data", (data) => { out += data.toString('binary'); });
                proc.stderr.on("data", (data) => { err += data.toString(); });
                proc.on("error", (e) => resolve({ success: false, out: "", error: e.message }));
                proc.on("close", (code) => {
                    if (code === 0 && out.length > 50) resolve({ success: true, out: out, error: null });
                    else resolve({ success: false, out: out, error: err.slice(-500) || `Exit code ${code}` });
                });
            } catch (e) { resolve({ success: false, out: "", error: e.message }); }
        });
    }
}

module.exports = { MoonsecBridge };
