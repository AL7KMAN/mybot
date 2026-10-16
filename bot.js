const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const https = require("https")
const http = require("http")
const { URL } = require("url")

class WeAreDevs {
  static ALPHA = ['0', "'", ')', 'L', 'O', 'C', 'F', '!', 'Q', 'M', 's', '"', '5', 'q', 'X', 'h', 'K', '/', '9', 'E', '.', 'e', 'j', 'm', 'u', '=', '7', 'S', '8', ';', 'b', '+', '_', '@', 'i', 'd', 'R', 'W', 'I', 't', '\\', '4', ',', '*', 'c', ']', 'g', '%', '[', '-', 'Z', 'P', 'U', 'N', 'T', 'D', '&', 'V', '(', '<', '^', 'l', 'a', 'p', 'G', 'k', 'Y', 'J', '?', '2', 'A', 'n', ':', 'o', 'H', '#', 'f', 'B', '1', '3', '6', '$', 'r', '>', '`']
  static LOOKUP = (() => { const l = {}; WeAreDevs.ALPHA.forEach((c, i) => l[c] = i); return l })()
  static decode(s) {
    if (!s || s.length === 0) return ""
    const out = []
    let i = 0
    const alpha = WeAreDevs.ALPHA
    const lookup = WeAreDevs.LOOKUP
    while (i < s.length) {
      const remaining = s.length - i
      let chunk = s.slice(i, i + Math.min(5, remaining))
      const origLen = chunk.length
      while (chunk.length < 5) chunk += alpha[84]
      let v = 0
      let valid = true
      for (const c of chunk) {
        if (lookup[c] === undefined) { valid = false; break }
        v = v * 85 + lookup[c]
      }
      if (!valid) { i += 1; continue }
      const bytes = [Math.floor(v / 16777216) % 256, Math.floor(v / 65536) % 256, Math.floor(v / 256) % 256, v % 256]
      const count = origLen - 1
      for (let k = 0; k < count; k++) out.push(bytes[k])
      i += origLen
    }
    return Buffer.from(out).toString("utf-8")
  }
  static extractStrings(code) {
    const re = /"\^([^"]+)"/g
    const results = []
    let m
    while ((m = re.exec(code)) !== null) {
      try {
        const dec = WeAreDevs.decode(m[1])
        if (dec && /^[\x20-\x7E\s]*$/.test(dec) && dec.length > 0) results.push({ raw: m[1], decoded: dec })
      } catch (e) {}
    }
    return results
  }
  static replaceAll(code) {
    let count = 0
    const replaced = code.replace(/"\^([^"]+)"/g, (full, payload) => {
      try {
        const dec = WeAreDevs.decode(payload)
        if (dec && /^[\x20-\x7E\s]*$/.test(dec) && dec.length > 0) { count++; return JSON.stringify(dec) }
      } catch (e) {}
      return full
    })
    return { code: replaced, count }
  }
}

class LuraphDecoder {
  static tryDecodeHex(s) {
    if (s.length % 2 !== 0) return null
    if (!/^[0-9a-fA-F]+$/.test(s)) return null
    try {
      let r = ""
      for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt(s.substr(i, 2), 16))
      return r
    } catch (e) { return null }
  }
  static extractConstants(code) {
    const matches = code.match(/\[0x[0-9a-fA-F]+\]\s*=\s*(\d+)/g) || []
    return matches.map(m => {
      const parts = m.match(/\[0x([0-9a-fA-F]+)\]\s*=\s*(\d+)/)
      return parts ? { key: parseInt(parts[1], 16), value: parseInt(parts[2]) } : null
    }).filter(Boolean)
  }
}

class Logger {
  constructor() { this.start = Date.now() }
  log(level, msg, data = {}) {
    const colors = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", SUCCESS: "\x1b[32m", DEBUG: "\x1b[35m" }
    console.log(`${colors[level] || ""}[${level}] ${msg}\x1b[0m`, Object.keys(data).length ? data : "")
  }
}

class UrlFetcher {
  static async fetch(url, timeout = 30000) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(url)
        if (!["http:", "https:"].includes(parsed.protocol)) return reject(new Error("Invalid protocol"))
        const lib = parsed.protocol === "https:" ? https : http
        const req = lib.get(url, { headers: { "User-Agent": "Mozilla/5.0 (Compatible; DeobfBot/3.0)" }, timeout }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return UrlFetcher.fetch(res.headers.location, timeout).then(resolve).catch(reject)
          }
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`))
          const chunks = []
          let size = 0
          res.on("data", (chunk) => {
            size += chunk.length
            if (size > 5000000) { req.destroy(); reject(new Error("File too large (5MB max)")) }
            chunks.push(chunk)
          })
          res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")))
        })
        req.on("error", reject)
        req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")) })
      } catch (e) { reject(e) }
    })
  }
  static detectSource(url) {
    if (/pastebin\.com\/[^\/]+$/i.test(url) && !url.includes("/raw/")) return url.replace("pastebin.com/", "pastebin.com/raw/")
    if (/gist\.github\.com\/([^\/]+)\/([^\/]+)$/i.test(url)) return url + "/raw"
    if (/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/i.test(url)) return url.replace("/blob/", "/raw/")
    if (/rawscripts\.net\/raw\//i.test(url)) return url
    if (/rscripts\.net\/raw\//i.test(url)) return url
    return url
  }
}

class StringTableAnalyzer {
  constructor(code) { this.code = code; this.tables = []; this.totalStrings = 0 }
  findTables() {
    const patterns = [
      /local\s+(\w+)\s*=\s*\{([\s\S]*?)\}/g,
      /(\w+)\s*=\s*\{([\s\S]*?)\}/g,
      /\[\s*["'][^"']+["']\s*\]\s*=\s*\{([\s\S]*?)\}/g,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(this.code)) !== null) {
        const name = m[1] || "_anon"
        const body = m[2] || m[1]
        const strings = this.extractStrings(body)
        if (strings.length >= 3) {
          this.tables.push({ name, strings, size: strings.length })
          this.totalStrings += strings.length
        }
      }
    }
    const seen = new Set()
    this.tables = this.tables.filter(t => { const key = t.name + "_" + t.strings.length; if (seen.has(key)) return false; seen.add(key); return true })
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
    return s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\").replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\(\d{1,3})/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
  }
}

class Decoders {
  static base64(s) {
    if (s.length < 8 || s.length % 4 !== 0) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null
    try { const dec = Buffer.from(s, "base64").toString("utf-8"); if (this.isPrintable(dec) && dec.length >= 3) return dec } catch (e) {}
    return null
  }
  static base64url(s) {
    if (s.length < 8) return null
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) return null
    try { const fixed = s.replace(/-/g, "+").replace(/_/g, "/"); const dec = Buffer.from(fixed, "base64").toString("utf-8"); if (this.isPrintable(dec)) return dec } catch (e) {}
    return null
  }
  static hex(s) {
    if (s.length < 8 || s.length % 2 !== 0) return null
    if (!/^[0-9a-fA-F]+$/.test(s)) return null
    try { let r = ""; for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt(s.substr(i, 2), 16)); if (this.isPrintable(r)) return r } catch (e) {}
    return null
  }
  static octal(s) {
    if (s.length < 9 || s.length % 3 !== 0) return null
    if (!/^[0-7]+$/.test(s)) return null
    try { let r = ""; for (let i = 0; i < s.length; i += 3) r += String.fromCharCode(parseInt(s.substr(i, 3), 8)); if (this.isPrintable(r)) return r } catch (e) {}
    return null
  }
  static xorBrute(s) {
    const results = []
    for (let key = 1; key < 256; key++) {
      let out = ""
      for (let i = 0; i < s.length && i < 300; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key)
      if (this.isPrintable(out) && this.hasLuaKeywords(out)) results.push({ key: "0x" + key.toString(16), sample: out.slice(0, 80) })
      if (results.length >= 3) break
    }
    return results
  }
  static rotN(s, n) {
    let r = ""
    for (const c of s) {
      const code = c.charCodeAt(0)
      if (code >= 32 && code <= 126) r += String.fromCharCode(((code - 32 + n) % 95) + 32)
      else r += c
    }
    return r
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
      { name: "WeAreDevs", patterns: [/wearedevs\.net\/obfuscator/i, /\[\[ v1\.0\.0 https:\/\/wearedevs/i, /ALPHA85/], weight: 40, confidence: 95 },
      { name: "Luraph v15", patterns: [/This file was protected using Luraph Obfuscator v15/i, /lura\.ph.*v15/i], weight: 40, confidence: 90 },
      { name: "Luraph v14", patterns: [/This file was protected using Luraph Obfuscator v14/i, /lura\.ph.*v14/i], weight: 40, confidence: 90 },
      { name: "Luraph v13", patterns: [/Luraph Obfuscator v13/i], weight: 35, confidence: 85 },
      { name: "Luraph", patterns: [/luraph/i, /lura\.ph/, /return setmetatable\(\{\[80\]=unpack/i], weight: 20, confidence: 70 },
      { name: "Moonsec V3", patterns: [/MoonSec V3/i, /MoonSec_StringsHiddenAttr/, /This file was protected with MoonSec V3/], weight: 40, confidence: 95 },
      { name: "Moonsec V2", patterns: [/MoonSec V2/i], weight: 30, confidence: 85 },
      { name: "IronBrew 2", patterns: [/ironbrew/i, /newproxy,setmetatable,getmetatable,select/i], weight: 25, confidence: 75 },
      { name: "IronBrew 1", patterns: [/ib1_/i, /IronBrew1/i], weight: 25, confidence: 70 },
      { name: "Prometheus", patterns: [/prometheus/i, /newproxy, setmetatable, getmetatable, select,/], weight: 25, confidence: 75 },
      { name: "Luarmor", patterns: [/luarmor\.net/i, /luraph_runtime1/, /GetTutorialState\("nil  nil/i, /ce_like_loadstring_fn/], weight: 40, confidence: 95 },
      { name: "luaobfuscator", patterns: [/luaobfuscator/i, /v0=string\.char;local v1=string\.byte/], weight: 30, confidence: 85 },
      { name: "Boronide", patterns: [/boronide/i], weight: 25, confidence: 75 },
      { name: "Hercules", patterns: [/hercules/i], weight: 25, confidence: 75 },
      { name: "AztupBrew", patterns: [/AztupBrew/i], weight: 25, confidence: 75 },
      { name: "Xen", patterns: [/Xen.*obf/i], weight: 20, confidence: 65 },
      { name: "Krnl", patterns: [/krnl.*obf/i], weight: 20, confidence: 65 },
    ]
    const matches = []
    for (const { name, patterns, weight, confidence } of checks) {
      for (const re of patterns) if (re.test(c)) matches.push({ name, weight, confidence, pattern: re.toString().slice(0, 60) })
    }
    matches.sort((a, b) => b.weight - a.weight)
    const best = matches[0]
    const genericSignals = []
    if (/\bwhile\s+true\s+do\b/.test(c)) genericSignals.push("while true do")
    if (/string\.char\s*\(/.test(c)) genericSignals.push("string.char")
    if (/loadstring|load\s*\(/.test(c)) genericSignals.push("loadstring")
    if (/getfenv|setfenv/.test(c)) genericSignals.push("getfenv/setfenv")
    if (/\[0x[0-9a-fA-F]+\]/.test(c)) genericSignals.push("hex keys")
    if (/"\^[A-Za-z0-9_\-+*\/%=?!<>@#$^&()\[\]{}:;,.\\'`~|]{5,}"/.test(c)) genericSignals.push("$ prefix strings")
    if (/return\s*\(\s*function\s*\(\s*\.\.\.\s*\)/.test(c)) genericSignals.push("IIFE pattern")
    if (c.length > 30000) genericSignals.push("large code")
    if (c.length > 100000) genericSignals.push("very large (>100KB)")
    return {
      name: best ? best.name : (genericSignals.length > 2 ? "Generic VM" : "Clean"),
      confidence: best ? best.confidence : (genericSignals.length * 15),
      signals: matches.map(m => m.name + " (" + m.pattern + ")").slice(0, 10),
      generic: genericSignals,
    }
  }
}

class VMAnalyzer {
  constructor(code) { this.code = code }
  analyze() {
    const c = this.code
    const r = { vmDetected: false, dispatchLoop: false, instructionTable: false, registerBased: false, stackBased: false, hexConstants: 0, bitwiseOps: 0, opcodeCount: 0, hints: [] }
    if (/while\s+true\s+do[\s\S]{0,300}(?:pc|op|instr|byte)\s*[=+]/i.test(c)) { r.dispatchLoop = true; r.vmDetected = true; r.hints.push("Dispatch loop") }
    if (/\{[^\}]*\[0x[0-9a-fA-F]+\]\s*=\s*[^,\}]+/i.test(c)) { r.instructionTable = true; r.hints.push("Opcode table") }
    if (/\bR\[[a-z]\]\s*=|\breg\[[a-z]\]\s*=/i.test(c)) { r.registerBased = true; r.hints.push("Register-based") }
    if (/stack\[top\]|push\s*\(|pop\s*\(/i.test(c)) { r.stackBased = true; r.hints.push("Stack-based") }
    r.hexConstants = (c.match(/0x[0-9a-fA-F]+/g) || []).length
    r.bitwiseOps = (c.match(/bit32\.|bxor|band|bor|bnot|rshift|lshift/g) || []).length
    r.opcodeCount = (c.match(/local\s+[A-Z_]+\s*=\s*\d+|\[\d+\]\s*=\s*function/g) || []).length
    if (r.hexConstants > 50 && r.bitwiseOps > 20) { r.vmDetected = true; r.hints.push("Heavy hex + bitwise") }
    return r
  }
}

class Deobfuscator {
  constructor(code, opts = {}) {
    this.original = code
    this.code = code
    this.opts = opts
    this.stats = { originalSize: code.length, finalSize: 0, escapesDecoded: 0, base64Decoded: 0, hexDecoded: 0, octalDecoded: 0, wearedevsDecoded: 0, stringsFound: 0, stringRefsResolved: 0, tablesFound: 0, mathSimplified: 0, antiDebugRemoved: 0, recursivePasses: 0, entropy: 0 }
    this.stringTableAnalyzer = new StringTableAnalyzer(code)
    this.detector = new Detector(code)
    this.vmAnalyzer = new VMAnalyzer(code)
    this.log = []
    this.warnings = []
    this.urls = []
    this.webhooks = []
    this.keys = []
    this.wearedevsSamples = []
  }
  async run() {
    this.log.push("started")
    this.detection = this.detector.detect()
    this.log.push(`type: ${this.detection.name} (${this.detection.confidence}%)`)
    this.vmReport = this.vmAnalyzer.analyze()
    if (this.vmReport.vmDetected) this.log.push("VM detected")
    if (this.detection.name === "WeAreDevs") {
      this.log.push("WeAreDevs - applying Ascii85")
      const wa = WeAreDevs.replaceAll(this.code)
      if (wa.count > 0) {
        this.stats.wearedevsDecoded = wa.count
        this.code = wa.code
        this.log.push(`decoded ${wa.count} strings`)
        this.wearedevsSamples = WeAreDevs.extractStrings(this.original).slice(0, 20)
      }
    }
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
  stripComments() { this.code = this.code.replace(/--\[=*\[[\s\S]*?\]=*\]/g, "").replace(/--\[\[[\s\S]*?\]\]/g, "").replace(/--[^\n\r]*/g, "") }
  decodeEscapes() {
    this.code = this.code.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => { const c = parseInt(h, 16); if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m })
    this.code = this.code.replace(/\\(\d{1,3})/g, (m, d) => { const c = parseInt(d, 10); if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m })
  }
  decodeUnicode() { this.code = this.code.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => { const c = parseInt(h, 16); if (c >= 32 && c <= 65535) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m }) }
  decodeBase64Layer() {
    this.code = this.code.replace(/["']([A-Za-z0-9+/]{20,}={0,2})["']/g, (m, b64) => { const dec = Decoders.base64(b64); if (dec) { this.stats.base64Decoded++; return JSON.stringify(dec) } return m })
    this.code = this.code.replace(/["']([A-Za-z0-9_-]{20,}={0,2})["']/g, (m, b64) => { const dec = Decoders.base64url(b64); if (dec && dec.length > 4) { this.stats.base64Decoded++; return JSON.stringify(dec) } return m })
  }
  decodeHexLayer() { this.code = this.code.replace(/["']([0-9a-fA-F]{12,})["']/g, (m, h) => { const dec = Decoders.hex(h); if (dec) { this.stats.hexDecoded++; return JSON.stringify(dec) } return m }) }
  decodeStringChar() { this.code = this.code.replace(/string\.char\s*\(\s*([0-9,\s+*%\-()xXa-fA-F]+)\s*\)/g, (m, args) => { try { const nums = args.split(/[,\s]+/).map(x => { try { return eval(x) } catch { return NaN } }).filter(n => !isNaN(n) && n >= 0 && n <= 255); if (nums.length > 0) { const str = String.fromCharCode(...nums); if (/^[\x20-\x7E\s]*$/.test(str)) { this.stats.escapesDecoded++; return JSON.stringify(str) } } } catch (e) {} return m }) }
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
      { re: /(\d+)\s*\*\s*(\d+)/g, fn: (a, b) => a * b },
    ]
    for (let pass = 0; pass < 10; pass++) {
      let changed = false
      for (const { re, fn } of ops) {
        this.code = this.code.replace(re, (m, a, b) => { try { const r = fn(parseInt(a), b !== undefined ? parseInt(b) : undefined); if (!isNaN(r) && Number.isFinite(r)) { this.stats.mathSimplified++; changed = true; return String(r) } } catch (e) {} return m })
      }
      if (!changed) break
    }
  }
  resolveStringRefs() {
    for (const table of this.stringTableAnalyzer.tables) {
      const re = new RegExp(`${table.name}\\s*\\[\\s*(\\d+)\\s*\\]`, "g")
      this.code = this.code.replace(re, (m, idx) => { const i = parseInt(idx) - 1; if (i >= 0 && i < table.strings.length) { this.stats.stringRefsResolved++; return JSON.stringify(table.strings[i]) } return m })
    }
  }
  removeAntiDebug() {
    const before = this.code.length
    this.code = this.code.replace(/debug\.getinfo\s*\([^)]*\)/g, "nil").replace(/debug\.traceback\s*\([^)]*\)/g, '""').replace(/debug\.sethook\s*\([^)]*\)/g, "").replace(/debug\.getlocal\s*\([^)]*\)/g, "nil").replace(/debug\.getupvalue\s*\([^)]*\)/g, "nil")
    this.stats.antiDebugRemoved = Math.floor((before - this.code.length) / 20)
  }
  extractUrls() { const m = this.code.match(/https?:\/\/[^\s"'`\)]+/g) || []; this.urls = [...new Set(m)].filter(u => u.length > 10 && u.length < 250).slice(0, 30) }
  extractWebhooks() { const m = this.code.match(/discord(?:app)?\.com\/api\/webhooks\/[^\s"'`]+/g) || []; this.webhooks = [...new Set(m)].slice(0, 15); if (this.webhooks.length > 0) this.warnings.push(`${this.webhooks.length} webhook(s)`) }
  extractKeys() {
    const patterns = [/key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi, /token\s*[=:]\s*["']([A-Za-z0-9_.\-]{20,})["']/gi, /api[_-]?key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi]
    for (const re of patterns) { let m; while ((m = re.exec(this.code)) !== null) this.keys.push(m[1].slice(0, 50)) }
    this.keys = [...new Set(this.keys)].slice(0, 15)
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
    while (passes < 5) { const before = this.code; this.decodeBase64Layer(); this.decodeHexLayer(); this.decodeEscapes(); if (this.code === before) break; passes++ }
    this.stats.recursivePasses = passes
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
  buildReport(time, user, source) {
    return [
      "DEOBFUSCATION REPORT V3", "======================",
      `User: ${user}`, `Source: ${source}`, `Time: ${time}ms`, "",
      "DETECTION", `Type: ${this.detection.name}`, `Confidence: ${this.detection.confidence}%`,
      `Signals: ${this.detection.signals.join(", ") || "None"}`,
      `Generic: ${this.detection.generic.join(", ") || "None"}`, "",
      "VM ANALYSIS", `VM: ${this.vmReport.vmDetected}`, `Dispatch: ${this.vmReport.dispatchLoop}`,
      `Instruction table: ${this.vmReport.instructionTable}`, `Register-based: ${this.vmReport.registerBased}`,
      `Stack-based: ${this.vmReport.stackBased}`, `Hex constants: ${this.vmReport.hexConstants}`,
      `Bitwise ops: ${this.vmReport.bitwiseOps}`, `Hints: ${this.vmReport.hints.join(" | ") || "None"}`, "",
      "STATISTICS", `Original: ${this.stats.originalSize} bytes`, `Final: ${this.stats.finalSize} bytes`,
      `Escapes: ${this.stats.escapesDecoded}`, `Base64: ${this.stats.base64Decoded}`,
      `Hex: ${this.stats.hexDecoded}`, `WeAreDevs: ${this.stats.wearedevsDecoded}`,
      `Strings: ${this.stats.stringsFound}`, `Refs: ${this.stats.stringRefsResolved}`,
      `Tables: ${this.stats.tablesFound}`, `Math: ${this.stats.mathSimplified}`,
      `Anti-debug: ${this.stats.antiDebugRemoved}`, `Layers: ${this.stats.recursivePasses}`,
      `Entropy: ${this.stats.entropy}`, "",
      "WEAREDEVS SAMPLES",
      this.wearedevsSamples.length > 0 ? this.wearedevsSamples.map(s => `"^${s.raw.slice(0, 40)}" -> "${s.decoded.slice(0, 60)}"`).join("\n") : "None",
      "", "URLS", this.urls.join("\n") || "None",
      "", "WEBHOOKS", this.webhooks.join("\n") || "None",
      "", "KEYS", this.keys.join("\n") || "None",
      "", "WARNINGS", this.warnings.join("\n") || "None",
      "", "LOG", this.log.join("\n"),
      "", "======================", "DEOBFUSCATED CODE", "======================",
      "", this.code,
    ].join("\n")
  }
}

const logger = new Logger()
const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const commands = [
  new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code text").addStringOption(o => o.setName("code").setDescription("Obfuscated code").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate from URL").addStringOption(o => o.setName("url").setDescription("URL to Lua file").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate uploaded file").addAttachmentOption(o => o.setName("file").setDescription("Lua file").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("Code").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("help").setDescription("Show help").toJSON(),
].map(c => c.toJSON ? c.toJSON() : c)

async function register() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  try { await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands }); logger.log("SUCCESS", "Commands registered") }
  catch (e) { logger.log("ERROR", "Register failed", { error: e.message }) }
}

async function processAndReply(interaction, code, source) {
  if (!code || code.length < 5) return interaction.editReply({ content: "Code too short" })
  if (code.length > 500000) return interaction.editReply({ content: "Code too large (max 500KB)" })
  const start = Date.now()
  const d = new Deobfuscator(code, { math: true, strings: true, beautify: true })
  await d.run()
  const time = Date.now() - start
  const embed = new EmbedBuilder()
    .setColor(d.webhooks.length > 0 ? "#ff0000" : "#00ff88")
    .setTitle("Deobfuscation V3 Complete")
    .addFields(
      { name: "Type", value: d.detection.name, inline: true },
      { name: "Confidence", value: `${d.detection.confidence}%`, inline: true },
      { name: "Time", value: `${time}ms`, inline: true },
      { name: "Size", value: `${d.stats.originalSize} -> ${d.stats.finalSize}`, inline: true },
      { name: "WeAreDevs", value: String(d.stats.wearedevsDecoded), inline: true },
      { name: "Escapes", value: String(d.stats.escapesDecoded), inline: true },
      { name: "Tables", value: String(d.stats.tablesFound), inline: true },
      { name: "Entropy", value: String(d.stats.entropy), inline: true },
      { name: "Source", value: source, inline: false },
    )
  if (d.vmReport.vmDetected) embed.addFields({ name: "VM", value: d.vmReport.hints.join("\n").slice(0, 1024) || "Detected" })
  if (d.urls.length > 0) embed.addFields({ name: "URLs", value: d.urls.slice(0, 5).join("\n").slice(0, 1024) })
  if (d.webhooks.length > 0) embed.addFields({ name: "Webhooks", value: d.webhooks.slice(0, 3).join("\n").slice(0, 1024) })
  if (d.warnings.length > 0) embed.addFields({ name: "Warnings", value: d.warnings.join("\n").slice(0, 1024) })
  const report = d.buildReport(time, interaction.user.tag, source)
  const buffer = Buffer.from(report, "utf-8")
  const file = new AttachmentBuilder(buffer, { name: `deobf_v3_${Date.now()}.txt` })
  await interaction.editReply({ embeds: [embed], files: [file] })
}

client.once("ready", () => { logger.log("SUCCESS", `Bot V3 online: ${client.user.tag}`); register() })

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return
  await interaction.deferReply()
  try {
    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder().setColor("#5865F2").setTitle("Deobf Bot V3")
        .setDescription("Lua deobfuscator V3 - text, URL, and file support")
        .addFields(
          { name: "/deobf", value: "Deobfuscate code text" },
          { name: "/deobf_url", value: "Deobfuscate from URL" },
          { name: "/deobf_file", value: "Deobfuscate uploaded file" },
          { name: "/detect", value: "Detect obfuscator type" },
          { name: "Supports", value: "WeAreDevs, Luraph, Moonsec, IronBrew, Prometheus, Luarmor, and more" },
        )
      return interaction.editReply({ embeds: [embed] })
    }
    if (interaction.commandName === "detect") {
      const code = interaction.options.getString("code")
      if (!code || code.length < 5) return interaction.editReply({ content: "Code too short" })
      const d = new Detector(code)
      const r = d.detect()
      const embed = new EmbedBuilder().setColor("#ffaa00").setTitle("Detection Result V3")
        .addFields(
          { name: "Type", value: r.name, inline: true },
          { name: "Confidence", value: `${r.confidence}%`, inline: true },
          { name: "Size", value: `${code.length} chars`, inline: true },
        )
      if (r.signals.length > 0) embed.addFields({ name: "Signals", value: r.signals.join("\n").slice(0, 1024) })
      if (r.generic.length > 0) embed.addFields({ name: "Generic", value: r.generic.join(", ") })
      return interaction.editReply({ embeds: [embed] })
    }
    if (interaction.commandName === "deobf") {
      return await processAndReply(interaction, interaction.options.getString("code"), "Direct input")
    }
    if (interaction.commandName === "deobf_url") {
      const url = interaction.options.getString("url")
      const fixedUrl = UrlFetcher.detectSource(url)
      try {
        const code = await UrlFetcher.fetch(fixedUrl)
        return await processAndReply(interaction, code, `URL: ${url}`)
      } catch (e) {
        return interaction.editReply({ content: `Fetch failed: ${e.message}` })
      }
    }
    if (interaction.commandName === "deobf_file") {
      const attachment = interaction.options.getAttachment("file")
      if (attachment.size > 5000000) return interaction.editReply({ content: "File too large (5MB max)" })
      const valid = [".lua", ".txt", ".luau", ".luac"]
      if (!valid.some(ext => attachment.name.toLowerCase().endsWith(ext))) {
        return interaction.editReply({ content: "Invalid file type (use .lua/.txt/.luau/.luac)" })
      }
      try {
        const res = await fetch(attachment.url)
        const code = await res.text()
        return await processAndReply(interaction, code, `File: ${attachment.name}`)
      } catch (e) {
        return interaction.editReply({ content: `File read failed: ${e.message}` })
      }
    }
  } catch (e) {
    logger.log("ERROR", "Error", { error: e.message })
    try { await interaction.editReply({ content: `Error: ${e.message}` }) } catch (e2) {}
  }
})

logger.log("INFO", "Starting V3...")
client.login(process.env.DISCORD_TOKEN).catch(e => { logger.log("ERROR", "Login failed", { error: e.message }); process.exit(1) })
