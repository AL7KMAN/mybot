const { LuaFactory } = require('wasmoon');

class LuaSandbox {
    static async run(code) {
        const factory = new LuaFactory();
        const lua = await factory.createEngine();
        const logs = [];
        try {
            const processedCode = code.replace(/0b([01]+)/g, (m, b) => parseInt(b, 2).toString());
            
            const fakeInst = (n) => ({
                ClassName: n, Name: n, Parent: null, Visible: true,
                Position: {X:0,Y:0,Z:0}, Size: {X:0,Y:0,Z:0},
                FindFirstChild: function() { return this; },
                WaitForChild: function() { return this; },
                FindFirstChildOfClass: function() { return this; },
                GetChildren: function() { return []; },
                GetDescendants: function() { return []; },
                IsA: function() { return true; },
                Destroy: function() {},
                Clone: function() { return this; },
                SetAttribute: function() {},
                GetAttribute: function() { return null; },
                Connect: function() { return { Disconnect: function() {} }; }
            });

            const env = {
                game: {
                    GetService: (n) => { logs.push(`[SERVICE] ${n}`); return fakeInst(n); },
                    HttpGet: (u) => { logs.push(`[HTTPGET] ${u}`); return "-- block"; },
                    IsLoaded: () => true, PlaceId: 123456, JobId: "sbx"
                },
                workspace: fakeInst("Workspace"),
                script: fakeInst("Script"),
                Instance: { new: (t) => fakeInst(t) },
                loadstring: (s) => { logs.push(`\n[CAPTURE:LOADSTRING]\n${s}\n[/CAPTURE]\n`); return () => {}; },
                load: (s) => { logs.push(`\n[CAPTURE:LOADSTRING]\n${s}\n[/CAPTURE]\n`); return () => {}; },
                require: (id) => { logs.push(`[CAPTURE:REQUIRE] ${id}`); return {}; },
                print: (...a) => logs.push(`[PRINT] ${a.join(' ')}`),
                warn: (...a) => logs.push(`[WARN] ${a.join(' ')}`),
                error: (...a) => { logs.push(`[ERROR] ${a.join(' ')}`); },
                task: { wait: () => {}, spawn: (f) => { try { f(); } catch(e){} }, delay: (t, f) => {} },
                getfenv: () => env, setfenv: (f) => f,
                getgenv: () => env,
                newproxy: () => ({}), setmetatable: (t) => t, getmetatable: () => null,
                rawget: (t, k) => t ? t[k] : null, rawset: (t, k, v) => { if (t) t[k] = v; return t; },
                unpack: (t) => Object.values(t || {}),
                typeof: (v) => typeof v === "object" ? "Instance" : typeof v,
                wait: () => {}, tick: () => Date.now(), time: () => 0,
                Vector3: { new: (x,y,z) => ({X:x,Y:y,Z:z}) },
                Vector2: { new: (x,y) => ({X:x,Y:y}) },
                CFrame: { new: () => ({}) },
                UDim2: { new: (xs,xo,ys,yo) => ({X:{Scale:xs,Offset:xo},Y:{Scale:ys,Offset:yo}}) },
                UDim: { new: (s,o) => ({Scale:s,Offset:o}) },
                Color3: { fromRGB: (r,g,b) => ({R:r,G:g,B:b}), new: (r,g,b) => ({R:r,G:g,B:b}) },
                Enum: new Proxy({}, { get: () => new Proxy({}, { get: (t,k) => k }) })
            };
            
            for (const [k, v] of Object.entries(env)) { try { lua.global.set(k, v); } catch(e) {} }
            
            const exec = lua.doString(processedCode);
            const timer = new Promise((_, rej) => setTimeout(() => rej(new Error("TIMEOUT")), 5000));
            await Promise.race([exec, timer]);
            return logs.join('\n') || "Sandbox ran, no logs captured.";
        } catch (e) {
            return logs.join('\n') + `\n[SANDBOX_ERROR] ${e.message}`;
        } finally {
            try { lua.global.close(); } catch(e) {}
        }
    }
}

module.exports = { LuaSandbox };
