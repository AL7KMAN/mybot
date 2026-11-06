const { LuaFactory } = require('wasmoon');

class LuaSandbox {
    static async run(code) {
        const factory = new LuaFactory();
        const lua = await factory.createEngine();
        const captures = [];
        const logs = [];
        let sandboxError = null;

        try {
            const processedCode = code.replace(/0b([01]+)/g, (match, bin) => parseInt(bin, 2).toString());
            
            const fakeInstance = (className) => new Proxy({}, {
                get: (target, prop) => {
                    if (prop === 'ClassName' || prop === 'Name') return className;
                    if (prop === 'Parent') return null;
                    if (prop === 'IsA') return () => true;
                    if (prop === 'FindFirstChild' || prop === 'WaitForChild' || prop === 'FindFirstChildOfClass') return () => fakeInstance(className);
                    if (prop === 'GetChildren' || prop === 'GetDescendants') return () => [];
                    if (prop === 'Connect') return () => ({ Disconnect: () => {} });
                    if (prop === 'Destroy' || prop === 'SetAttribute') return () => {};
                    if (prop === 'GetAttribute') return () => null;
                    if (prop === 'Clone') return () => fakeInstance(className);
                    if (prop === 'HttpGet') return (url) => { logs.push(`[HTTPGET] ${url}`); return ""; };
                    return fakeInstance(className);
                }
            });

            const safePush = (str) => {
                if (str && typeof str === 'string' && str.trim().length > 0) {
                    logs.push(str);
                }
            };

            const fakeEnv = {
                game: fakeInstance("DataModel"),
                workspace: fakeInstance("Workspace"),
                script: fakeInstance("Script"),
                plugin: fakeInstance("Plugin"),
                shared: {},
                Instance: { new: (type) => fakeInstance(type) },
                
                loadstring: (src) => {
                    if (typeof src === 'string') captures.push(src);
                    return () => {};
                },
                load: (src) => {
                    if (typeof src === 'string') captures.push(src);
                    return () => {};
                },
                require: (id) => {
                    logs.push(`[REQUIRE] ${id}`);
                    return fakeInstance("ModuleScript");
                },
                
                print: (...args) => { try { safePush(`[PRINT] ${args.join(' ')}`); } catch(e){} },
                warn: (...args) => { try { safePush(`[WARN] ${args.join(' ')}`); } catch(e){} },
                error: (...args) => { try { safePush(`[ERROR] ${args.join(' ')}`); } catch(e){} },
                
                getfenv: () => fakeEnv,
                setfenv: (f, env) => f,
                getgenv: () => fakeEnv,
                newproxy: (val) => ({}),
                setmetatable: (t, mt) => t,
                getmetatable: (t) => null,
                rawget: (t, k) => (t && t[k]) ? t[k] : null,
                rawset: (t, k, v) => { if (t) t[k] = v; return t; },
                rawequal: (a, b) => a === b,
                unpack: (t, i, j) => Object.values(t || {}).slice(i || 0, j || undefined),
                select: (n, ...args) => {
                    if (n === '#') return args.length;
                    return args[n - 1];
                },
                
                typeof: (v) => {
                    if (v === null) return "nil";
                    if (Array.isArray(v)) return "table";
                    return typeof v === "object" ? "Instance" : typeof v;
                },
                
                task: { wait: () => {}, spawn: (f) => { try { f(); } catch(e){} }, delay: (t, f) => {} },
                wait: () => {}, tick: () => Date.now(), time: () => Math.floor(Date.now() / 1000),
                
                Vector3: { new: (x, y, z) => ({ X: x||0, Y: y||0, Z: z||0 }) },
                Vector2: { new: (x, y) => ({ X: x||0, Y: y||0 }) },
                CFrame: { new: (...args) => ({}) },
                UDim2: { new: (xs, xo, ys, yo) => ({ X: { Scale: xs||0, Offset: xo||0 }, Y: { Scale: ys||0, Offset: yo||0 } }) },
                UDim: { new: (s, o) => ({ Scale: s||0, Offset: o||0 }) },
                Color3: { fromRGB: (r, g, b) => ({ R: r||0, G: g||0, B: b||0 }), new: (r, g, b) => ({ R: r||0, G: g||0, B: b||0 }) },
                Enum: new Proxy({}, { get: () => new Proxy({}, { get: (t, k) => k }) })
            };

            for (const [key, val] of Object.entries(fakeEnv)) {
                try { lua.global.set(key, val); } catch (e) {}
            }

            const execute = lua.doString(processedCode);
            
            const timeout = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("SANDBOX_TIMEOUT (Infinite Loop Detected)")), 6000)
            );
            
            await Promise.race([execute, timeout]);

        } catch (e) {
            sandboxError = e.message;
        } finally {
            try { lua.global.close(); } catch(e) {}
        }

        return {
            captures: captures.filter(c => c && c.length > 30),
            logs: logs.join('\n'),
            error: sandboxError
        };
    }
}

module.exports = { LuaSandbox };
