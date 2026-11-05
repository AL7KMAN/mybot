local captures = {}
local captured = false

local function serialize(val, depth)
    depth = depth or 0
    if depth > 3 then return tostring(val) end
    local t = type(val)
    if t == "string" then return string.format("%q", val) end
    if t == "number" or t == "boolean" or t == "nil" then return tostring(val) end
    if t == "table" then
        local parts = {}
        for k, v in pairs(val) do
            table.insert(parts, "[" .. tostring(k) .. "]=" .. serialize(v, depth + 1))
        end
        return "{" .. table.concat(parts, ",") .. "}"
    end
    return tostring(val)
end

local function capture(kind, payload)
    if captured then return end
    captured = true
    print("[CAPTURE:" .. kind .. "]")
    print(payload)
    print("[/CAPTURE]")
    io.stdout:flush()
end

local function hooked_loadstring(src)
    capture("LOADSTRING", tostring(src))
    return function() end
end

local function hooked_require(id)
    capture("REQUIRE", tostring(id))
    return setmetatable({}, {__index = function() return function() end end})
end

local function hooked_HttpGet(url)
    print("[HTTPGET] " .. tostring(url))
    io.stdout:flush()
    return ""
end

local fakeInstance = {}
fakeInstance.__index = fakeInstance
function fakeInstance:GetService() return setmetatable({}, self) end
function fakeInstance:FindFirstChild() return setmetatable({}, self) end
function fakeInstance:WaitForChild() return setmetatable({}, self) end
function fakeInstance:IsA() return true end
function fakeInstance:Connect() return {Disconnect = function() end} end
function fakeInstance:Destroy() end
function fakeInstance:Clone() return setmetatable({}, self) end
function fakeInstance:GetChildren() return {} end
function fakeInstance:GetDescendants() return {} end

local Vector3 = {}
function Vector3.new(x, y, z) return {X = x or 0, Y = y or 0, Z = z or 0} end
local Vector2 = {}
function Vector2.new(x, y) return {X = x or 0, Y = y or 0} end
local CFrame = {}
function CFrame.new(...) return {} end
local UDim2 = {}
function UDim2.new(...) return {} end
local UDim = {}
function UDim.new(...) return {} end
local Color3 = {}
function Color3.fromRGB(r, g, b) return {R = r, G = g, B = b} end
function Color3.new(r, g, b) return {R = r, G = g, B = b} end

local env = {
    print = function() end,
    warn = function() end,
    error = function(msg) end,
    loadstring = hooked_loadstring,
    load = hooked_loadstring,
    require = hooked_require,
    game = setmetatable({HttpGet = hooked_HttpGet}, fakeInstance),
    workspace = setmetatable({}, fakeInstance),
    script = setmetatable({}, fakeInstance),
    Instance = {new = function(self, t) return setmetatable({}, fakeInstance) end},
    Vector3 = Vector3, Vector2 = Vector2, CFrame = CFrame,
    UDim2 = UDim2, UDim = UDim, Color3 = Color3,
    getfenv = function() return env end,
    setfenv = function() end,
    getgenv = function() return env end,
    newproxy = function() return setmetatable({}, {}) end,
    setmetatable = setmetatable,
    getmetatable = getmetatable,
    select = select,
    unpack = unpack,
    tostring = tostring,
    tonumber = tonumber,
    type = type,
    pcall = pcall,
    xpcall = xpcall,
    math = math, string = string, table = table,
    task = {wait = function() end, spawn = function(f) pcall(f) end, delay = function(t, f) pcall(f) end},
    wait = function() end,
    spawn = function(f) pcall(f) end,
    tick = function() return 0 end,
    time = function() return 0 end,
    os = os, io = io,
}

setfenv(1, env)

if arg and arg[1] then
    local file = io.open(arg[1], "r")
    if file then
        local code = file:read("*a")
        file:close()
        local status, err = pcall(loadstring or load, code)
        if not status then
            print("[EXEC_ERROR] " .. tostring(err))
        end
    else
        print("[ERROR] File not found: " .. tostring(arg[1]))
    end
else
    print("[ERROR] No input file")
end
