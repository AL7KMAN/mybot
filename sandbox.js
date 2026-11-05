const { LuaFactory } = require('wasmoon');

class LuaSandbox {
    static async run(code) {
        const factory = new LuaFactory();
        const lua = await factory.createEngine();
        const logs = [];
        try {
            const processedCode = code.replace(/0b([01]+)/g, (match, bin) => parseInt(bin, 2).toString());
            
            const fakeInstance = (className) => ({
                ClassName: className, Name: className, Parent: null, Visible: true,
                Position: { X: 0, Y: 0, Z: 0 }, Size: { X: 0, Y: 0, Z: 0 },
                Children: [], FindFirstChild: function() { return this; },
                WaitForChild: function() { return this; }, GetChildren: function() { return []; },
                IsA: function() { return true; }, Destroy: function() {},
                Clone: function() { return this; }, SetAttribute: function() {},
                GetAttribute: function() { return null; },
                Connect: function() { return { Disconnect: function() {} }; }
            });

            const fakeEnv = {
                game: {
                    GetService: (name) => { logs.push(`[GETSERVICE] ${name}`); return fakeInstance(name); },
                    HttpGet: (url) => { logs.push(`[HTTPGET] ${url}`); return "-- sandbox block"; },
                    IsLoaded: () => true, PlaceId: 123456, JobId: "sandbox-123"
                },
                workspace: fakeInstance("Workspace"),
                script: fakeInstance("Script"),
                Instance: { new: (type) => { logs.push(`[INSTANCE] ${type}`); return fakeInstance(type); } },
                loadstring: (src) => { logs.push(`[LOADSTRING]`); return () => {}; },
                print: (...args) => { logs.push(`[PRINT] ${args.join(' ')}`); },
                warn: (...args) => { logs.push(`[WARN] ${args.join(' ')}`); },
                error: (...args) => { logs.push(`[ERROR] ${args.join(' ')}`); throw new Error(args[0]); },
                task: { wait: () => {}, spawn: (f) => { try { f(); } catch(e){} }, delay: (t, f) => {} },
                getfenv: () => fakeEnv, setfenv: (f, env) => f,
                newproxy: () => ({}), setmetatable: (t, mt) => t, getmetatable: (t) => null,
                rawget: (t, k) => t ? t[k] : null, rawset: (t, k, v) => { if (t) t[k] = v; return t; },
                unpack: (t) => Object.values(t || {}), typeof: (v) => typeof v === "object" ? "Instance" : typeof v,
                wait: () => {}, tick: () => Date.now(),
                Vector3: { new: (x, y, z) => ({ X: x, Y: y, Z: z }) },
                Vector2: { new: (x, y) => ({ X: x, Y: y }) },
                CFrame: { new: (x, y, z) => ({ X: x || 0, Y: y || 0, Z: z || 0 }) },
                UDim2: { new: (xs, xo, ys, yo) => ({ X: { Scale: xs, Offset: xo }, Y: { Scale: ys, Offset: yo } }) },
                UDim: { new: (s, o) => ({ Scale: s, Offset: o }) },
                Color3: { fromRGB: (r, g, b) => ({ R: r, G: g, B: b }), new: (r, g, b) => ({ R: r, G: g, B: b }) },
                Enum: new Proxy({}, { get: () => new Proxy({}, { get: (t, k) => k }) })
            };
            
            for (const [key, val] of Object.entries(fakeEnv)) { try { lua.global.set(key, val); } catch(e) {} }
            
            const execute = lua.doString(processedCode);
            const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Sandbox execution timed out")), 4000));
            await Promise.race([execute, timeout]);
            
            return logs.length > 0 ? logs.join('\n') : "Sandbox executed successfully, but no logs were captured.";
        } catch (e) {
            return logs.join('\n') + `\n[SANDBOX_ERROR] ${e.message}`;
        } finally {
            try { lua.global.close(); } catch(e) {}
        }
    }
}

module.exports = { LuaSandbox };
