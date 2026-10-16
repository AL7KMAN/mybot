const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")

class Logger {
  constructor() { this.logs = []; this.start = Date.now() }
  log(level, msg, data = {}) {
    const colors = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", SUCCESS: "\x1b[32m", DEBUG: "\x1b[35m" }
    console.log(`${colors[level] || ""}[${level}] ${msg}\x1b[0m`, Object.keys(data).length ? data : "")
    this.logs.push({ t: Date.now() - this.start, level, msg, data })
  }
}

class StringTableAnalyzer {
  constructor(code) { this.code = code; this.tables = []; this.totalStrings = 0 }

  findTables() {
    const patterns = [
      /local\s+(\w+)\s*=\s*\{([\s\S]*?)\}/g,
      /(\w+)\s*=\s*\{([\s\S]*?)\}/g,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(this.code)) !== null) {
        const [, name, body] = m
        const strings = this.extractStrings(body)
        if (strings.length >= 3) {
          this.tables.push({ name, strings, size: strings.length })
          this.totalStrings += strings.length
        }
      }
    }
    const seen = new Set()
    this.tables = this.tables.filter(t => {
      const key = t.name + "_" + t.strings.length
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    return this.tables
  }

  extractStrings(body) {
    const out = []
    const re = /["']((?:\\.|[^"'\\])*)["']/g
    let m
    while ((m = re.exec(body)) !== null) out.push(this.unescape(m[1]))
    return out
  }

  unescape(s) {
    return s
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\(\d{1,3})/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
  }
}

class Decoders {
  static base64(s) {
    if (s.length < 8 || s.length % 4 !== 0) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null
    try {
      const dec = Buffer.from(s, "base64").toString("utf-8")
      if (this.isPrintable(dec) && dec.length >= 3) return dec
    } catch (e) {}
    return null
  }

  static base64url(s) {
    if (s.length < 8) return null
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null
    try {
      const fixed = s.replace(/-/g, "+").replace(/_/g, "/")
      const dec = Buffer.from(fixed, "base64").toString("utf-8")
      if (this.isPrintable(dec)) return dec
    } catch (e) {}
    return null
  }

  static base85(s) {
    if (s.length < 10 || s.length % 5 !== 0) return null
    const ALPHA = "!\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
    try {
      const bytes = []
      for (let i = 0; i < s.length; i += 5) {
        let v = 0n
        for (let j = 0; j < 5; j++) {
          const idx = ALPHA.indexOf(s[i + j])
          if (idx < 0) return null
          v = v * 85n + BigInt(idx)
        }
        for (let k = 3; k >= 0; k--) bytes.push(Number((v >> BigInt(k * 8)) & 0xFFn))
      }
      const dec = Buffer.from(bytes).toString("utf-8")
      if (this.isPrintable(dec)) return dec
    } catch (e) {}
    return null
  }

  static hex(s) {
    if (s.length < 8 || s.length % 2 !== 0) return null
    if (!/^[0-9a-fA-F]+$/.test(s)) return null
    try {
      let r = ""
      for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt(s.substr(i, 2), 16))
      if (this.isPrintable(r)) return r
    } catch (e) {}
    return null
  }

  static xorBrute(s) {
    const results = []
    for (let key = 1; key < 256; key++) {
      let out = ""
      for (let i = 0; i < s.length && i < 500; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key)
      if (this.isPrintable(out) && this.hasLuaKeywords(out)) results.push({ key: "0x" + key.toString(16), sample: out.slice(0, 100) })
    }
    return results.slice(0, 3)
  }

  static reverse(s) {
    const r = s.split("").reverse().join("")
    return this.isPrintable(r) ? r : null
  }

  static isPrintable(s) {
    if (!s || s.length === 0) return false
    let p = 0
    for (const c of s) if (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126) p++
    return p / s.length > 0.85
  }

  static hasLuaKeywords(s) {
    return /\b(local|function|end|if|then|else|return|print|game|for|while)\b/.test(s)
  }
}

class Detector {
  constructor(code) { this.code = code }

  detect() {
    const c = this.code
    const checks = [
      { name: "Luraph v15", patterns: [/This file was protected using Luraph Obfuscator v15/i, /lura\.ph\/?.*v15/i], weight: 30 },
      { name: "Luraph v14", patterns: [/This file was protected using Luraph Obfuscator v14/i], weight: 30 },
      { name: "Luraph", patterns: [/luraph/i, /lura\.ph/, /return setmetatable\(\{\[80\]=unpack/i], weight: 15 },
      { name: "MoonsecV3", patterns: [/MoonSec V3/i, /MoonSec_StringsHiddenAttr/, /This file was protected with MoonSec V3/], weight: 30 },
      { name: "MoonsecV2", patterns: [/MoonSec V2/i], weight: 25 },
      { name: "IronBrew2", patterns: [/ironbrew/i, /newproxy,setmetatable,getmetatable,select/i], weight: 20 },
      { name: "WeAreDevs", patterns: [/wearedevs\.net\/obfuscator/i, /ALPHA85/, /\[\[ v1\.0\.0 https:\/\/wearedevs/i], weight: 30 },
      { name: "Prometheus", patterns: [/prometheus/i, /newproxy, setmetatable, getmetatable, select,/], weight: 20 },
      { name: "Luarmor", patterns: [/luarmor\.net/i, /luraph_runtime1/, /GetTutorialState\("nil  nil/i, /ce_like_loadstring_fn/], weight: 30 },
      { name: "luaobfuscator", patterns: [/luaobfuscator/i, /v0=string\.char;local v1=string\.byte/], weight: 25 },
      { name: "Veil", patterns: [/veil/i], weight: 10 },
      { name: "Boronide", patterns: [/boronide/i], weight: 20 },
      { name: "Hercules", patterns: [/hercules/i], weight: 20 },
    ]

    const matches = []
    for (const { name, patterns, weight } of checks) {
      for (const re of patterns) {
        if (re.test(c)) matches.push({ name, weight, pattern: re.toString().slice(0, 50) })
      }
    }
    matches.sort((a, b) => b.weight - a.weight)
    const best = matches[0]

    const genericSignals = []
    if (/\bwhile\s+true\s+do\b/.test(c)) genericSignals.push("while true do")
    if (/string\.char\s*\(/.test(c)) genericSignals.push("string.char")
    if (/loadstring|load\s*\(/.test(c)) genericSignals.push("loadstring")
    if (/getfenv|setfenv/.test(c)) genericSignals.push("getfenv/setfenv")
    if (/\[0x[0-9a-fA-F]+\]/.test(c)) genericSignals.push("hex keys")
    if (c.length > 30000) genericSignals.push("large code")

    return {
      name: best ? best.name : (genericSignals.length > 2 ? "Generic VM" : "Clean"),
      confidence: best ? Math.min(100, best.weight * 3) : (genericSignals.length * 15),
      signals: matches.map(m => m.name + " (" + m.pattern + ")").slice(0, 10),
      generic: genericSignals,
    }
  }
}

class VMAnalyzer {
  constructor(code) { this.code = code }

  analyze() {
    const c = this.code
    const r = {
      vmDetected: false, dispatchLoop: false, instructionTable: false,
      registerBased: false, stackBased: false, hexConstants: 0,
      bitwiseOps: 0, opcodeCount: 0, hints: [],
    }

    if (/while\s+true\s+do[\s\S]{0,200}(?:pc|op|instr|byte)\s*[=+]/i.test(c)) {
      r.dispatchLoop = true; r.vmDetected = true; r.hints.push("VM dispatch loop")
    }
    if (/\{[^\}]*\[0x[0-9a-fA-F]+\]\s*=\s*[^,\}]+/i.test(c)) {
      r.instructionTable = true; r.hints.push("Opcode table with hex keys")
    }
    if (/\bR\[[a-z]\]\s*=|\breg\[[a-z]\]\s*=/i.test(c)) {
      r.registerBased = true; r.hints.push("Register-based VM")
    }
    if (/stack\[top\]|push\s*\(|pop\s*\(/i.test(c)) {
      r.stackBased = true; r.hints.push("Stack-based VM")
    }

    r.hexConstants = (c.match(/0x[0-9a-fA-F]+/g) || []).length
    r.bitwiseOps = (c.match(/bit32\.|bxor|band|bor|bnot|rshift|lshift/g) || []).length
    r.opcodeCount = (c.match(/local\s+[A-Z_]+\s*=\s*\d+|\[\d+\]\s*=\s*function/g) || []).length

    if (r.hexConstants > 50 && r.bitwiseOps > 20) {
      r.vmDetected = true; r.hints.push("Heavy hex + bitwise ops")
    }
    return r
  }
}

class Deobfuscator {
  constructor(code, opts = {}) {
    this.original = code
    this.code = code
    this.opts = opts
    this.stats = {
      originalSize: code.length, finalSize: 0, escapesDecoded: 0, base64Decoded: 0,
      hexDecoded: 0, stringsFound: 0, stringRefsResolved: 0, tablesFound: 0,
      mathSimplified: 0, antiDebugRemoved: 0, recursivePasses: 0, entropy: 0,
    }
    this.stringTableAnalyzer = new StringTableAnalyzer(code)
    this.detector = new Detector(code)
    this.vmAnalyzer = new VMAnalyzer(code)
    this.log = []
    this.warnings = []
    this.urls = []
    this.webhooks = []
    this.keys = []
  }

  async run() {
    this.log.push("started")
    this.detection = this.detector.detect()
    this.log.push(`type: ${this.detection.name} (${this.detection.confidence}%)`)
    this.vmReport = this.vmAnalyzer.analyze()
    if (this.vmReport.vmDetected) this.log.push("VM detected")
    this.stripComments()
    this.decodeEscapes()
    this.decodeUnicode()
    this.decodeBase64Layer()
    this.decodeHexLayer()
    this.decodeStringChar()
    this.simplifyMath()
    this.stringTableAnalyzer.code = this.code
    this.stringTableAnalyzer.findTables()
    this.stats.tablesFound = this.stringTableAnalyzer.tables.length
    this.stats.stringsFound = this.stringTableAnalyzer.totalStrings
    this.resolveStringRefs()
    this.removeAntiDebug()
    this.extractUrls()
    this.extractWebhooks()
    this.extractKeys()
    this.calculateEntropy()
    this.tryRecursiveDecode()
    if (this.opts.beautify !== false) this.beautify()
    this.stats.finalSize = this.code.length
    this.log.push(`done: ${this.code.length} bytes`)
  }

  stripComments() {
    this.code = this.code
      .replace(/--\[=*\[[\s\S]*?\]=*\]/g, "")
      .replace(/--\[\[[\s\S]*?\]\]/g, "")
      .replace(/--[^\n\r]*/g, "")
  }

  decodeEscapes() {
    this.code = this.code.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => {
      const c = parseInt(h, 16)
      if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) }
      return m
    })
    this.code = this.code.replace(/\\(\d{1,3})/g, (m, d) => {
      const c = parseInt(d, 10)
      if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) }
      return m
    })
    if (this.stats.escapesDecoded > 0) this.log.push(`escapes: ${this.stats.escapesDecoded}`)
  }

  decodeUnicode() {
    this.code = this.code.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
      const c = parseInt(h, 16)
      if (c >= 32 && c <= 65535) { this.stats.escapesDecoded++; return String.fromCharCode(c) }
      return m
    })
  }

  decodeBase64Layer() {
    this.code = this.code.replace(/["']([A-Za-z0-9+/]{20,}={0,2})["']/g, (m, b64) => {
      const dec = Decoders.base64(b64)
      if (dec) { this.stats.base64Decoded++; return JSON.stringify(dec) }
      return m
    })
    this.code = this.code.replace(/["']([A-Za-z0-9_-]{20,}={0,2})["']/g, (m, b64) => {
      const dec = Decoders.base64url(b64)
      if (dec && dec.length > 4) { this.stats.base64Decoded++; return JSON.stringify(dec) }
      return m
    })
    if (this.stats.base64Decoded > 0) this.log.push(`base64: ${this.stats.base64Decoded}`)
  }

  decodeHexLayer() {
    this.code = this.code.replace(/["']([0-9a-fA-F]{12,})["']/g, (m, h) => {
      const dec = Decoders.hex(h)
      if (dec) { this.stats.hexDecoded++; return JSON.stringify(dec) }
      return m
    })
    if (this.stats.hexDecoded > 0) this.log.push(`hex: ${this.stats.hexDecoded}`)
  }

  decodeStringChar() {
    const re = /string\.char\s*\(\s*([0-9,\s+*%\-()xXa-fA-F]+)\s*\)/g
    this.code = this.code.replace(re, (m, args) => {
      try {
        const nums = args.split(/[,\s]+/).map(x => { try { return eval(x) } catch { return NaN } }).filter(n => !isNaN(n) && n >= 0 && n <= 255)
        if (nums.length > 0) {
          const str = String.fromCharCode(...nums)
          if (/^[\x20-\x7E\s]*$/.test(str)) { this.stats.escapesDecoded++; return JSON.stringify(str) }
        }
      } catch (e) {}
      return m
    })
  }

  simplifyMath() {
    const ops = [
      { re: /bit32\.bxor\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, fn: (a, b) => a ^ b },
      { re: /bit32\.band\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, fn: (a, b) => a & b },
      { re: /bit32\.bor\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, fn: (a, b) => a | b },
      { re: /bit32\.lshift\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, fn: (a, b) => a << b },
      { re: /bit32\.rshift\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)/g, fn: (a, b) => a >> b },
      { re: /bit32\.bnot\s*\(\s*(-?\d+)\s*\)/g, fn: (a) => ~a },
      { re: /math\.floor\s*\(\s*(-?\d+)\s*\/\s*(-?\d+)\s*\)/g, fn: (a, b) => Math.floor(a / b) },
      { re: /math\.ceil\s*\(\s*(-?\d+)\s*\/\s*(-?\d+)\s*\)/g, fn: (a, b) => Math.ceil(a / b) },
      { re: /\((\d+)\s*\+\s*(\d+)\)/g, fn: (a, b) => a + b },
      { re: /\((\d+)\s*-\s*(\d+)\)/g, fn: (a, b) => a - b },
      { re: /\((\d+)\s*\*\s*(\d+)\)/g, fn: (a, b) => a * b },
    ]
    for (let pass = 0; pass < 10; pass++) {
      let changed = false
      for (const { re, fn } of ops) {
        this.code = this.code.replace(re, (m, a, b) => {
          try {
            const r = fn(parseInt(a), b !== undefined ? parseInt(b) : undefined)
            if (!isNaN(r) && Number.isFinite(r)) { this.stats.mathSimplified++; changed = true; return String(r) }
          } catch (e) {}
          return m
        })
      }
      if (!changed) break
    }
    if (this.stats.mathSimplified > 0) this.log.push(`math: ${this.stats.mathSimplified}`)
  }

  resolveStringRefs() {
    for (const table of this.stringTableAnalyzer.tables) {
      const re = new RegExp(`${table.name}\\s*\\[\\s*(\\d+)\\s*\\]`, "g")
      this.code = this.code.replace(re, (m, idx) => {
        const i = parseInt(idx) - 1
        if (i >= 0 && i < table.strings.length) { this.stats.stringRefsResolved++; return JSON.stringify(table.strings[i]) }
        return m
      })
    }
    if (this.stats.stringRefsResolved > 0) this.log.push(`refs: ${this.stats.stringRefsResolved}`)
  }

  removeAntiDebug() {
    const before = this.code.length
    this.code = this.code
      .replace(/debug\.getinfo\s*\([^)]*\)/g, "nil")
      .replace(/debug\.traceback\s*\([^)]*\)/g, '""')
      .replace(/debug\.sethook\s*\([^)]*\)/g, "")
      .replace(/debug\.getlocal\s*\([^)]*\)/g, "nil")
      .replace(/debug\.getupvalue\s*\([^)]*\)/g, "nil")
      .replace(/debug\.setupvalue\s*\([^)]*\)/g, "nil")
    this.stats.antiDebugRemoved = Math.floor((before - this.code.length) / 20)
  }

  extractUrls() {
    const m = this.code.match(/https?:\/\/[^\s"'`\)]+/g) || []
    this.urls = [...new Set(m)].filter(u => u.length > 10 && u.length < 200).slice(0, 25)
  }

  extractWebhooks() {
    const m = this.code.match(/discord(?:app)?\.com\/api\/webhooks\/[^\s"'`]+/g) || []
    this.webhooks = [...new Set(m)].slice(0, 10)
    if (this.webhooks.length > 0) this.warnings.push(`${this.webhooks.length} Discord webhook(s)`)
  }

  extractKeys() {
    const patterns = [
      /key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi,
      /token\s*[=:]\s*["']([A-Za-z0-9_.\-]{20,})["']/gi,
      /api[_-]?key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(this.code)) !== null) this.keys.push(m[1].slice(0, 40))
    }
    this.keys = [...new Set(this.keys)].slice(0, 10)
    if (this.keys.length > 0) this.warnings.push(`${this.keys.length} possible key(s)`)
  }

  calculateEntropy() {
    const freq = {}
    for (const c of this.code) freq[c] = (freq[c] || 0) + 1
    let e = 0
    const len = this.code.length
    for (const c of Object.values(freq)) { const p = c / len; e -= p * Math.log2(p) }
    this.stats.entropy = parseFloat((e / 8).toFixed(3))
    if (e / 8 > 0.7) this.warnings.push(`High entropy (${this.stats.entropy})`)
  }

  tryRecursiveDecode() {
    let passes = 0
    while (passes < 5) {
      const before = this.code
      this.decodeBase64Layer()
      this.decodeHexLayer()
      this.decodeEscapes()
      if (this.code === before) break
      passes++
    }
    this.stats.recursivePasses = passes
    if (passes > 0) this.log.push(`${passes} extra layers`)
  }

  beautify() {
    const lines = this.code.split(/[;\n]/).filter(l => l.trim())
    let indent = 0
    const result = []
    for (let line of lines) {
      const t = line.trim()
      if (!t) continue
      if (/^(end|else|elseif|until|\}|\))/.test(t)) indent = Math.max(0, indent - 1)
      result.push("  ".repeat(indent) + t)
      if (/(then|do|function|repeat|else|elseif|\{|\()$/.test(t) && !/^(else|elseif)/.test(t)) indent++
    }
    this.code = result.join("\n")
  }

  buildReport(time, user) {
    return [
      "DEOBFUSCATION REPORT",
      "====================",
      `User: ${user}`,
      `Time: ${time}ms`,
      "",
      "DETECTION",
      `Type: ${this.detection.name}`,
      `Confidence: ${this.detection.confidence}%`,
      `Signals: ${this.detection.signals.join(", ") || "None"}`,
      `Generic: ${this.detection.generic.join(", ") || "None"}`,
      "",
      "VM ANALYSIS",
      `VM: ${this.vmReport.vmDetected}`,
      `Dispatch: ${this.vmReport.dispatchLoop}`,
      `Instruction table: ${this.vmReport.instructionTable}`,
      `Register-based: ${this.vmReport.registerBased}`,
      `Stack-based: ${this.vmReport.stackBased}`,
      `Hex constants: ${this.vmReport.hexConstants}`,
      `Bitwise ops: ${this.vmReport.bitwiseOps}`,
      `Hints: ${this.vmReport.hints.join(" | ") || "None"}`,
      "",
      "STATISTICS",
      `Original: ${this.stats.originalSize} bytes`,
      `Final: ${this.stats.finalSize} bytes`,
      `Escapes: ${this.stats.escapesDecoded}`,
      `Base64: ${this.stats.base64Decoded}`,
      `Hex: ${this.stats.hexDecoded}`,
      `Strings: ${this.stats.stringsFound}`,
      `Refs: ${this.stats.stringRefsResolved}`,
      `Tables: ${this.stats.tablesFound}`,
      `Math: ${this.stats.mathSimplified}`,
      `Anti-debug: ${this.stats.antiDebugRemoved}`,
      `Layers: ${this.stats.recursivePasses}`,
      `Entropy: ${this.stats.entropy}`,
      "",
      "URLS",
      this.urls.join("\n") || "None",
      "",
      "WEBHOOKS",
      this.webhooks.join("\n") || "None",
      "",
      "KEYS",
      this.keys.join("\n") || "None",
      "",
      "WARNINGS",
      this.warnings.join("\n") || "None",
      "",
      "LOG",
      this.log.join("\n"),
      "",
      "====================",
      "DEOBFUSCATED CODE",
      "====================",
      "",
      this.code,
    ].join("\n")
  }
}

const logger = new Logger()
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const commands = [
  new SlashCommandBuilder()
    .setName("deobf")
    .setDescription("Deobfuscate Lua script")
    .addStringOption(o => o.setName("code").setDescription("Obfuscated code").setRequired(true))
    .addBooleanOption(o => o.setName("math").setDescription("Simplify math").setRequired(false))
    .addBooleanOption(o => o.setName("strings").setDescription("Extract string tables").setRequired(false))
    .addBooleanOption(o => o.setName("beautify").setDescription("Beautify code").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("detect")
    .setDescription("Detect obfuscator type")
    .addStringOption(o => o.setName("code").setDescription("Code").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Help")
    .toJSON(),
]

async function register() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands })
    logger.log("SUCCESS", "Commands registered")
  } catch (e) { logger.log("ERROR", "Register failed", { error: e.message }) }
}

client.once("ready", () => {
  logger.log("SUCCESS", `Bot online: ${client.user.tag}`)
  register()
})

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  await interaction.deferReply()

  try {
    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("Deobf Bot")
        .setDescription("Lua deobfuscator")
        .addFields(
          { name: "/deobf", value: "Full deobfuscation + report" },
          { name: "/detect", value: "Detect type only" },
        )
      return interaction.editReply({ embeds: [embed] })
    }

    const code = interaction.options.getString("code")
    if (!code || code.length < 5) return interaction.editReply({ content: "Code too short" })
    if (code.length > 500000) return interaction.editReply({ content: "Code too large (max 500KB)" })

    if (interaction.commandName === "detect") {
      const d = new Detector(code)
      const r = d.detect()
      const embed = new EmbedBuilder()
        .setColor("#ffaa00")
        .setTitle("Detection Result")
        .addFields(
          { name: "Type", value: r.name, inline: true },
          { name: "Confidence", value: `${r.confidence}%`, inline: true },
          { name: "Size", value: `${code.length} chars`, inline: true },
        )
      if (r.signals.length > 0) embed.addFields({ name: "Signals", value: r.signals.join("\n").slice(0, 1024) })
      if (r.generic.length > 0) embed.addFields({ name: "Generic", value: r.generic.join(", ") })
      return interaction.editReply({ embeds: [embed] })
    }

    const start = Date.now()
    const d = new Deobfuscator(code, {
      math: interaction.options.getBoolean("math") ?? true,
      strings: interaction.options.getBoolean("strings") ?? true,
      beautify: interaction.options.getBoolean("beautify") ?? true,
    })
    await d.run()
    const time = Date.now() - start

    const embed = new EmbedBuilder()
      .setColor(d.webhooks.length > 0 ? "#ff0000" : "#00ff88")
      .setTitle("Deobfuscation Complete")
      .addFields(
        { name: "Type", value: d.detection.name, inline: true },
        { name: "Confidence", value: `${d.detection.confidence}%`, inline: true },
        { name: "Time", value: `${time}ms`, inline: true },
        { name: "Size", value: `${d.stats.originalSize} -> ${d.stats.finalSize}`, inline: true },
        { name: "Strings", value: String(d.stats.stringsFound), inline: true },
        { name: "Math", value: String(d.stats.mathSimplified), inline: true },
        { name: "Tables", value: String(d.stats.tablesFound), inline: true },
        { name: "Refs", value: String(d.stats.stringRefsResolved), inline: true },
        { name: "Entropy", value: String(d.stats.entropy), inline: true },
        { name: "Layers", value: String(d.stats.recursivePasses), inline: true },
      )

    if (d.vmReport.vmDetected) embed.addFields({ name: "VM", value: d.vmReport.hints.join("\n") || "Detected" })
    if (d.urls.length > 0) embed.addFields({ name: "URLs", value: d.urls.slice(0, 5).join("\n").slice(0, 1024) })
    if (d.warnings.length > 0) embed.addFields({ name: "Warnings", value: d.warnings.join("\n").slice(0, 1024) })

    const report = d.buildReport(time, interaction.user.tag)
    const buffer = Buffer.from(report, "utf-8")
    const file = new AttachmentBuilder(buffer, { name: `deobf_${Date.now()}.txt` })

    await interaction.editReply({ embeds: [embed], files: [file] })
    logger.log("SUCCESS", "Deobf complete", { user: interaction.user.tag, type: d.detection.name })
  } catch (e) {
    logger.log("ERROR", "Error", { error: e.message })
    await interaction.editReply({ content: `Error: ${e.message}` })
  }
})

logger.log("INFO", "Starting bot...")
client.login(process.env.DISCORD_TOKEN).catch(e => {
  logger.log("ERROR", "Login failed", { error: e.message })
  process.exit(1)
})
