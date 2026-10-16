const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")

class Base85 {
  static buildLookup(alphabet) {
    const l = {}
    for (let i = 0; i < alphabet.length; i++) l[alphabet[i]] = i
    return l
  }
  static decode(str, alphabet) {
    if (!str || !alphabet || alphabet.length !== 85) return null
    const lookup = Base85.buildLookup(alphabet)
    const out = []
    let i = 0
    while (i < str.length) {
      const remaining = str.length - i
      let chunk = str.slice(i, i + Math.min(5, remaining))
      const origLen = chunk.length
      while (chunk.length < 5) chunk += alphabet[84]
      let v = 0n
      let valid = true
      for (const c of chunk) {
        if (lookup[c] === undefined) { valid = false; break }
        v = v * 85n + BigInt(lookup[c])
      }
      if (!valid) { i += 1; continue }
      const bytes = [
        Number((v >> 24n) & 0xFFn),
        Number((v >> 16n) & 0xFFn),
        Number((v >> 8n) & 0xFFn),
        Number(v & 0xFFn)
      ]
      const count = origLen - 1
      for (let k = 0; k < count; k++) out.push(bytes[k])
      i += origLen
    }
    return Buffer.from(out).toString("utf-8")
  }
  static extractAlphabet(code) {
    const tableMatches = code.match(/local\s+\w+\s*=\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g) || []
    for (const tm of tableMatches) {
      const entries = {}
      const re = /(?:\[["']([^"']+)["']\]|([A-Za-z_]\w*))\s*=\s*(\d+)/g
      let m
      while ((m = re.exec(tm)) !== null) {
        const key = m[1] !== undefined ? m[1] : m[2]
        const val = parseInt(m[3])
        if (val >= 0 && val < 85) entries[val] = key
      }
      const keys = Object.keys(entries)
      if (keys.length >= 80 && keys.length <= 90) {
        const alpha = []
        let ok = true
        for (let i = 0; i < 85; i++) {
          if (entries[i] === undefined) { ok = false; break }
          let ch = entries[i]
          if (ch.startsWith("\\x")) {
            const hm = ch.match(/^\\x([0-9a-fA-F]{2})/)
            if (hm) ch = String.fromCharCode(parseInt(hm[1], 16))
          } else if (ch.startsWith("\\")) {
            const dm = ch.match(/^\\(\d{1,3})/)
            if (dm) ch = String.fromCharCode(parseInt(dm[1], 10))
          }
          if (ch.length !== 1) { ok = false; break }
          alpha.push(ch)
        }
        if (ok) return alpha
      }
    }
    return null
  }
}

class WeAreDevs {
  static ALPHA_V1 = ['0', "'", ')', 'L', 'O', 'C', 'F', '!', 'Q', 'M', 's', '"', '5', 'q', 'X', 'h', 'K', '/', '9', 'E', '.', 'e', 'j', 'm', 'u', '=', '7', 'S', '8', ';', 'b', '+', '_', '@', 'i', 'd', 'R', 'W', 'I', 't', '\\', '4', ',', '*', 'c', ']', 'g', '%', '[', '-', 'Z', 'P', 'U', 'N', 'T', 'D', '&', 'V', '(', '<', '^', 'l', 'a', 'p', 'G', 'k', 'Y', 'J', '?', '2', 'A', 'n', ':', 'o', 'H', '#', 'f', 'B', '1', '3', '6', '$', 'r', '>', '`']
  static extractStrings(code, alphabet, prefix) {
    const esc = prefix === "^" ? "\\^" : prefix
    const re = new RegExp(`"${esc}([^"]+)"`, "g")
    const results = []
    let m
    while ((m = re.exec(code)) !== null) {
      try {
        const dec = Base85.decode(m[1], alphabet)
        if (dec && /^[\x20-\x7E\s]*$/.test(dec) && dec.length > 0) results.push({ raw: m[1], decoded: dec })
      } catch (e) {}
    }
    return results
  }
  static replaceAll(code, alphabet, prefix) {
    const esc = prefix === "^" ? "\\^" : prefix
    const re = new RegExp(`"${esc}([^"]+)"`, "g")
    let count = 0
    const replaced = code.replace(re, (full, payload) => {
      try {
        const dec = Base85.decode(payload, alphabet)
        if (dec && /^[\x20-\x7E\s]*$/.test(dec) && dec.length > 0) { count++; return JSON.stringify(dec) }
      } catch (e) {}
      return full
    })
    return { code: replaced, count }
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
  static base32(s) {
    if (s.length < 8) return null
    if (!/^[A-Z2-7]+=*$/.test(s.toUpperCase())) return null
    try {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      const clean = s.toUpperCase().replace(/=/g, "")
      let bits = ""
      for (const c of clean) {
        const i = alphabet.indexOf(c)
        if (i < 0) return null
        bits += i.toString(2).padStart(5, "0")
      }
      let out = []
      for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.substr(i, 8), 2))
      const dec = Buffer.from(out).toString("utf-8")
      if (this.isPrintable(dec)) return dec
    } catch (e) {}
    return null
  }
  static base58(s) {
    if (s.length < 8) return null
    const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) return null
    try {
      let n = 0n
      for (const c of s) {
        const i = alphabet.indexOf(c)
        if (i < 0) return null
        n = n * 58n + BigInt(i)
      }
      const hex = n.toString(16).padStart(2, "0")
      const out = []
      for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16))
      const dec = Buffer.from(out).toString("utf-8")
      if (this.isPrintable(dec)) return dec
    } catch (e) {}
    return null
  }
  static base91(s) {
    if (s.length < 8) return null
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\""
    try {
      let b = 0, n = 0, out = []
      for (const c of s) {
        const i = alphabet.indexOf(c)
        if (i < 0) return null
        if (b === 0) { n = i; b = 1 }
        else { n += i * 91; b = 0; out.push(n & 0xFF, (n >> 8) & 0xFF) }
      }
      if (b === 1) out.push(n & 0xFF)
      const dec = Buffer.from(out).toString("utf-8")
      if (this.isPrintable(dec)) return dec
    } catch (e) {}
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
  static urlDecode(s) {
    if (!s.includes("%")) return null
    try { const dec = decodeURIComponent(s); if (dec !== s && this.isPrintable(dec)) return dec } catch (e) {}
    return null
  }
  static ascii85(s) {
    if (!s || s.length < 2) return null
    try {
      const out = []
      let i = 0
      while (i < s.length) {
        if (s[i] === "z") { out.push(0, 0, 0, 0); i++; continue }
        if (s[i] === "y") { out.push(32, 32, 32, 32); i++; continue }
        const remaining = s.length - i
        let chunk = s.slice(i, i + Math.min(5, remaining))
        const origLen = chunk.length
        while (chunk.length < 5) chunk += "u"
        let v = 0n
        let valid = true
        for (const c of chunk) {
          const code = c.charCodeAt(0) - 33
          if (code < 0 || code > 84) { valid = false; break }
          v = v * 85n + BigInt(code)
        }
        if (!valid) { i += 1; continue }
        const bytes = [Number((v >> 24n) & 0xFFn), Number((v >> 16n) & 0xFFn), Number((v >> 8n) & 0xFFn), Number(v & 0xFFn)]
        const count = origLen - 1
        for (let k = 0; k < count; k++) out.push(bytes[k])
        i += origLen
      }
      const str = Buffer.from(out).toString("utf-8")
      if (/^[\x20-\x7E\s]*$/.test(str) && str.length > 3) return str
    } catch (e) {}
    return null
  }
  static xorBrute(s) {
    const results = []
    for (let key = 1; key < 256; key++) {
      let out = ""
      for (let i = 0; i < s.length && i < 500; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key)
      if (this.isPrintable(out) && this.hasLuaKeywords(out)) {
        results.push({ key: "0x" + key.toString(16), sample: out.slice(0, 150), confidence: this.scoreText(out) })
      }
    }
    return results.sort((a, b) => b.confidence - a.confidence).slice(0, 3)
  }
  static isPrintable(s) {
    if (!s || s.length === 0) return false
    let p = 0
    for (const c of s) if (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126) p++
    return p / s.length > 0.85
  }
  static hasLuaKeywords(s) {
    return /\b(local|function|end|if|then|else|return|print|game|for|while|do|nil|true|false)\b/.test(s)
  }
  static scoreText(s) {
    let score = 0
    if (/\bfunction\b/.test(s)) score += 3
    if (/\blocal\b/.test(s)) score += 3
    if (/\bend\b/.test(s)) score += 2
    if (/\bprint\b/.test(s)) score += 3
    if (/\bgame\b/.test(s)) score += 3
    if (/game:GetService/.test(s)) score += 5
    if (/Instance\.new/.test(s)) score += 4
    if (/["'][^"']+["']/.test(s)) score += 1
    if (/local\s+\w+\s*=/.test(s)) score += 2
    return score
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
        const name = m[1]
        const body = m[2]
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

class Detector {
  constructor(code) { this.code = code }
  detect() {
    const c = this.code
    const checks = [
      { name: "WeAreDevs", patterns: [/wearedevs\.net\/obfuscator/i, /\[\[ v1\.0\.0 https:\/\/wearedevs/i, /ALPHA85/], weight: 40, confidence: 95 },
      { name: "Luraph v15", patterns: [/This file was protected using Luraph Obfuscator v15/i, /lura\.ph.*v15/i], weight: 40, confidence: 90 },
      { name: "Luraph v14", patterns: [/This file was protected using Luraph Obfuscator v14/i], weight: 40, confidence: 90 },
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
      { name: "Veil", patterns: [/veil.*obf/i], weight: 20, confidence: 65 },
      { name: "LuaObf", patterns: [/LuaObf/i], weight: 20, confidence: 65 },
      { name: "Nuke", patterns: [/nuke.*obf/i], weight: 20, confidence: 65 },
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
    if (/return\s*\(\s*function\s*\(\s*\.\.\.\s*\)/.test(c)) genericSignals.push("IIFE pattern")
    if (/bit32\.bxor|bit\.bxor/.test(c)) genericSignals.push("XOR ops")
    if (/string\.reverse/.test(c)) genericSignals.push("string.reverse")
    if (c.length > 30000) genericSignals.push("large code")
    if (c.length > 100000) genericSignals.push("very large (>100KB)")
    return {
      name: best ? best.name : (genericSignals.length > 2 ? "Generic VM" : "Clean"),
      confidence: best ? best.confidence : Math.min(95, genericSignals.length * 15),
      signals: matches.map(m => m.name + " (" + m.pattern + ")").slice(0, 10),
      generic: genericSignals,
    }
  }
}

class Deobfuscator {
  constructor(code, opts = {}) {
    this.original = code
    this.code = code
    this.opts = opts
    this.stats = {
      originalSize: code.length, finalSize: 0,
      escapesDecoded: 0, base64Decoded: 0, base32Decoded: 0, base58Decoded: 0, base91Decoded: 0,
      hexDecoded: 0, octalDecoded: 0, urlDecoded: 0,
      wearedevsDecoded: 0, ascii85Decoded: 0, xorDecoded: 0,
      stringsFound: 0, stringRefsResolved: 0, tablesFound: 0, mathSimplified: 0,
      antiDebugRemoved: 0, recursivePasses: 0, entropy: 0,
      extractedAlphabet: false, alphabetPasses: 0,
    }
    this.stringTableAnalyzer = new StringTableAnalyzer(code)
    this.detector = new Detector(code)
    this.log = []
    this.warnings = []
    this.urls = []
    this.webhooks = []
    this.keys = []
    this.wearedevsSamples = []
    this.xorResults = []
    this.alphabet = null
  }

  async run() {
    this.log.push("started")
    this.detection = this.detector.detect()
    this.log.push(`type: ${this.detection.name} (${this.detection.confidence}%)`)

    if (this.detection.name === "WeAreDevs") {
      this.log.push("WeAreDevs detected - extracting alphabet")
      const extracted = Base85.extractAlphabet(this.code)
      if (extracted) {
        this.alphabet = extracted
        this.stats.extractedAlphabet = true
        this.log.push("alphabet extracted (85 chars)")
      } else {
        this.alphabet = WeAreDevs.ALPHA_V1
        this.log.push("using fallback alphabet")
      }
      for (let pass = 0; pass < 5; pass++) {
        let total = 0
        for (const prefix of ["j", "^"]) {
          const r = WeAreDevs.replaceAll(this.code, this.alphabet, prefix)
          total += r.count
          this.code = r.code
        }
        if (total === 0) break
        this.stats.wearedevsDecoded += total
        this.stats.alphabetPasses++
        this.log.push(`pass ${pass + 1}: ${total} strings`)
      }
      for (const prefix of ["j", "^"]) {
        const samples = WeAreDevs.extractStrings(this.original, this.alphabet, prefix)
        this.wearedevsSamples.push(...samples.slice(0, 20))
      }
    }

    this.stripComments()
    this.decodeEscapes()
    this.decodeUnicode()
    this.decodeBase64Layer()
    this.decodeBase32Layer()
    this.decodeBase58Layer()
    this.decodeBase91Layer()
    this.decodeHexLayer()
    this.decodeOctalLayer()
    this.decodeURLLayer()
    this.decodeAscii85Layer()
    this.decodeStringChar()
    this.simplifyMath()
    this.stringTableAnalyzer.code = this.code
    this.stringTableAnalyzer.findTables()
    this.stats.tablesFound = this.stringTableAnalyzer.tables.length
    this.stats.stringsFound = this.stringTableAnalyzer.totalStrings
    this.resolveStringRefs()
    this.removeAntiDebug()
    this.tryXorBrute()
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
    const before = this.stats.escapesDecoded
    this.code = this.code.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => { const c = parseInt(h, 16); if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m })
    this.code = this.code.replace(/\\(\d{1,3})/g, (m, d) => { const c = parseInt(d, 10); if (c >= 32 && c <= 126) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m })
    if (this.stats.escapesDecoded > before) this.log.push(`escapes: ${this.stats.escapesDecoded - before}`)
  }

  decodeUnicode() {
    this.code = this.code.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => { const c = parseInt(h, 16); if (c >= 32 && c <= 65535) { this.stats.escapesDecoded++; return String.fromCharCode(c) } return m })
  }

  decodeBase64Layer() {
    const before = this.stats.base64Decoded
    this.code = this.code.replace(/["']([A-Za-z0-9+/]{20,}={0,2})["']/g, (m, b64) => { const dec = Decoders.base64(b64); if (dec) { this.stats.base64Decoded++; return JSON.stringify(dec) } return m })
    this.code = this.code.replace(/["']([A-Za-z0-9_-]{20,}={0,2})["']/g, (m, b64) => { const dec = Decoders.base64url(b64); if (dec && dec.length > 4) { this.stats.base64Decoded++; return JSON.stringify(dec) } return m })
    if (this.stats.base64Decoded > before) this.log.push(`base64: ${this.stats.base64Decoded - before}`)
  }

  decodeBase32Layer() {
    const before = this.stats.base32Decoded
    this.code = this.code.replace(/["']([A-Z2-7]{16,}=*)["']/g, (m, b32) => { const dec = Decoders.base32(b32); if (dec) { this.stats.base32Decoded++; return JSON.stringify(dec) } return m })
    if (this.stats.base32Decoded > before) this.log.push(`base32: ${this.stats.base32Decoded - before}`)
  }

  decodeBase58Layer() {
    const before = this.stats.base58Decoded
    this.code = this.code.replace(/["']([1-9A-HJ-NP-Za-km-z]{20,})["']/g, (m, b58) => { const dec = Decoders.base58(b58); if (dec) { this.stats.base58Decoded++; return JSON.stringify(dec) } return m })
    if (this.stats.base58Decoded > before) this.log.push(`base58: ${this.stats.base58Decoded - before}`)
  }

  decodeBase91Layer() {
    const before = this.stats.base91Decoded
    this.code = this.code.replace(/["']([A-Za-z0-9!#$%&()*+,.\/:;<=>?@\[\]^_`{|}~"]{20,})["']/g, (m, b91) => {
      if (/[а-яА-Я\u0600-\u06FF]/.test(b91)) return m
      const dec = Decoders.base91(b91)
      if (dec && dec.length > 3) { this.stats.base91Decoded++; return JSON.stringify(dec) }
      return m
    })
    if (this.stats.base91Decoded > before) this.log.push(`base91: ${this.stats.base91Decoded - before}`)
  }

  decodeHexLayer() {
    const before = this.stats.hexDecoded
    this.code = this.code.replace(/["']([0-9a-fA-F]{12,})["']/g, (m, h) => { const dec = Decoders.hex(h); if (dec) { this.stats.hexDecoded++; return JSON.stringify(dec) } return m })
    if (this.stats.hexDecoded > before) this.log.push(`hex: ${this.stats.hexDecoded - before}`)
  }

  decodeOctalLayer() {
    const before = this.stats.octalDecoded
    this.code = this.code.replace(/"(\d{9,})"/g, (m, o) => { const dec = Decoders.octal(o); if (dec) { this.stats.octalDecoded++; return JSON.stringify(dec) } return m })
    if (this.stats.octalDecoded > before) this.log.push(`octal: ${this.stats.octalDecoded - before}`)
  }

  decodeURLLayer() {
    const before = this.stats.urlDecoded
    this.code = this.code.replace(/["']([^"']*%[0-9a-fA-F]{2}[^"']*)["']/g, (m, s) => { const dec = Decoders.urlDecode(s); if (dec) { this.stats.urlDecoded++; return JSON.stringify(dec) } return m })
    if (this.stats.urlDecoded > before) this.log.push(`url: ${this.stats.urlDecoded - before}`)
  }

  decodeAscii85Layer() {
    const before = this.stats.ascii85Decoded
    this.code = this.code.replace(/["']([!-u~]{20,})["']/g, (m, s) => {
      if (s.startsWith("^") || s.startsWith("j")) return m
      const dec = Decoders.ascii85(s)
      if (dec) { this.stats.ascii85Decoded++; return JSON.stringify(dec) }
      return m
    })
    if (this.stats.ascii85Decoded > before) this.log.push(`ascii85: ${this.stats.ascii85Decoded - before}`)
  }

  decodeStringChar() {
    this.code = this.code.replace(/string\.char\s*\(\s*([0-9,\s+*%\-()xXa-fA-F]+)\s*\)/g, (m, args) => {
      try {
        const nums = args.split(/[,\s]+/).map(x => { try { return eval(x) } catch { return NaN } }).filter(n => !isNaN(n) && n >= 0 && n <= 255)
        if (nums.length > 0) { const str = String.fromCharCode(...nums); if (/^[\x20-\x7E\s]*$/.test(str)) { this.stats.escapesDecoded++; return JSON.stringify(str) } }
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
      { re: /(\d+)\s*\*\s*(\d+)/g, fn: (a, b) => a * b },
    ]
    for (let pass = 0; pass < 12; pass++) {
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

  tryXorBrute() {
    const suspiciousStrings = this.code.match(/["']([A-Za-z0-9+/=]{16,})["']/g) || []
    for (const str of suspiciousStrings.slice(0, 5)) {
      const inner = str.slice(1, -1)
      const results = Decoders.xorBrute(inner)
      if (results.length > 0) {
        this.xorResults.push({ input: inner.slice(0, 40), results })
        this.stats.xorDecoded++
      }
    }
    if (this.stats.xorDecoded > 0) this.log.push(`xor candidates: ${this.stats.xorDecoded}`)
  }

  extractUrls() {
    const m = this.code.match(/https?:\/\/[^\s"'`\)]+/g) || []
    this.urls = [...new Set(m)].filter(u => u.length > 10 && u.length < 250).slice(0, 30)
  }

  extractWebhooks() {
    const m = this.code.match(/discord(?:app)?\.com\/api\/webhooks\/[^\s"'`]+/g) || []
    this.webhooks = [...new Set(m)].slice(0, 15)
    if (this.webhooks.length > 0) this.warnings.push(`${this.webhooks.length} webhook(s)`)
  }

  extractKeys() {
    const patterns = [
      /key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi,
      /token\s*[=:]\s*["']([A-Za-z0-9_.\-]{20,})["']/gi,
      /api[_-]?key\s*[=:]\s*["']([A-Za-z0-9_\-]{16,})["']/gi,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(this.code)) !== null) this.keys.push(m[1].slice(0, 50))
    }
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
    while (passes < 8) {
      const before = this.code
      this.decodeBase64Layer()
      this.decodeBase32Layer()
      this.decodeBase58Layer()
      this.decodeBase91Layer()
      this.decodeHexLayer()
      this.decodeOctalLayer()
      this.decodeEscapes()
      this.decodeStringChar()
      this.decodeAscii85Layer()
      this.decodeURLLayer()
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

  buildReport(time, source) {
    const alphabetBlock = this.alphabet ? this.alphabet.join("") : "Not extracted"
    const xorBlock = this.xorResults.length > 0
      ? this.xorResults.map(x => `Input: "${x.input}..."\n` + x.results.map(r => `  Key ${r.key} -> "${r.sample}"`).join("\n")).join("\n\n")
      : "None"
    const waBlock = this.wearedevsSamples.length > 0
      ? this.wearedevsSamples.map(s => `"${s.raw.slice(0, 40)}" -> "${s.decoded.slice(0, 60)}"`).join("\n")
      : "None"
    return [
      "DEOBFUSCATION REPORT", "====================",
      `Source: ${source}`, `Time: ${time}ms`, "",
      "DETECTION", `Type: ${this.detection.name}`, `Confidence: ${this.detection.confidence}%`,
      `Signals: ${this.detection.signals.join(", ") || "None"}`,
      `Generic: ${this.detection.generic.join(", ") || "None"}`, "",
      "EXTRACTED ALPHABET", alphabetBlock, "",
      "STATISTICS",
      `Original: ${this.stats.originalSize} bytes`, `Final: ${this.stats.finalSize} bytes`,
      `Escapes: ${this.stats.escapesDecoded}`, `Base64: ${this.stats.base64Decoded}`,
      `Base32: ${this.stats.base32Decoded}`, `Base58: ${this.stats.base58Decoded}`,
      `Base91: ${this.stats.base91Decoded}`, `Hex: ${this.stats.hexDecoded}`,
      `Octal: ${this.stats.octalDecoded}`, `URL: ${this.stats.urlDecoded}`,
      `Ascii85: ${this.stats.ascii85Decoded}`, `WeAreDevs: ${this.stats.wearedevsDecoded}`,
      `Alphabet passes: ${this.stats.alphabetPasses}`, `XOR: ${this.stats.xorDecoded}`,
      `Strings: ${this.stats.stringsFound}`, `Refs: ${this.stats.stringRefsResolved}`,
      `Tables: ${this.stats.tablesFound}`, `Math: ${this.stats.mathSimplified}`,
      `Anti-debug: ${this.stats.antiDebugRemoved}`, `Layers: ${this.stats.recursivePasses}`,
      `Entropy: ${this.stats.entropy}`, "",
      "WEAREDEVS SAMPLES", waBlock,
      "", "XOR BRUTE RESULTS", xorBlock,
      "", "URLS", this.urls.join("\n") || "None",
      "", "WEBHOOKS", this.webhooks.join("\n") || "None",
      "", "KEYS", this.keys.join("\n") || "None",
      "", "WARNINGS", this.warnings.join("\n") || "None",
      "", "====================", "DEOBFUSCATED CODE", "====================",
      "", this.code,
    ].join("\n")
  }
}

const logger = new Logger()

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const commands = [
  new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code").addStringOption(o => o.setName("code").setDescription("Obfuscated code").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate from URL").addStringOption(o => o.setName("url").setDescription("URL to Lua file").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate uploaded file").addAttachmentOption(o => o.setName("file").setDescription("Lua file").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("Code").setRequired(true)).toJSON(),
  new SlashCommandBuilder().setName("help").setDescription("Show help").toJSON(),
]

async function register() {
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  try {
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands })
    logger.log("SUCCESS", "Commands registered")
  } catch (e) {
    logger.log("ERROR", "Register failed", { error: e.message })
  }
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
    .setTitle("Deobfuscation Complete")
    .addFields(
      { name: "Type", value: d.detection.name, inline: true },
      { name: "Confidence", value: `${d.detection.confidence}%`, inline: true },
      { name: "Time", value: `${time}ms`, inline: true },
      { name: "Size", value: `${d.stats.originalSize} -> ${d.stats.finalSize}`, inline: true },
      { name: "WeAreDevs", value: String(d.stats.wearedevsDecoded), inline: true },
      { name: "Base64", value: String(d.stats.base64Decoded), inline: true },
      { name: "Base32/58/91", value: `${d.stats.base32Decoded}/${d.stats.base58Decoded}/${d.stats.base91Decoded}`, inline: true },
      { name: "Hex/Octal", value: `${d.stats.hexDecoded}/${d.stats.octalDecoded}`, inline: true },
      { name: "Entropy", value: String(d.stats.entropy), inline: true },
    )
  if (d.urls.length > 0) embed.addFields({ name: "URLs", value: d.urls.slice(0, 5).join("\n").slice(0, 1024) })
  if (d.webhooks.length > 0) embed.addFields({ name: "Webhooks", value: d.webhooks.slice(0, 3).join("\n").slice(0, 1024) })
  if (d.warnings.length > 0) embed.addFields({ name: "Warnings", value: d.warnings.join("\n").slice(0, 1024) })
  const report = d.buildReport(time, source)
  const buffer = Buffer.from(report, "utf-8")
  const file = new AttachmentBuilder(buffer, { name: `deobf_${Date.now()}.txt` })
  await interaction.editReply({ embeds: [embed], files: [file] })
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
      const embed = new EmbedBuilder().setColor("#5865F2").setTitle("Deobf Bot")
        .setDescription("Lua deobfuscator — auto alphabet extraction")
        .addFields(
          { name: "/deobf", value: "Deobfuscate code text" },
          { name: "/deobf_url", value: "Deobfuscate from URL" },
          { name: "/deobf_file", value: "Deobfuscate uploaded file" },
          { name: "/detect", value: "Detect obfuscator type" },
          { name: "Encodings", value: "Base64, Base32, Base58, Base85, Base91, Hex, Octal, Ascii85, URL, XOR" },
          { name: "Obfuscators", value: "WeAreDevs, Luraph, Moonsec, IronBrew, Prometheus, Luarmor, luaobfuscator, Boronide, Hercules, and more" },
        )
      return interaction.editReply({ embeds: [embed] })
    }
    if (interaction.commandName === "detect") {
      const code = interaction.options.getString("code")
      if (!code || code.length < 5) return interaction.editReply({ content: "Code too short" })
      const d = new Detector(code)
      const r = d.detect()
      const embed = new EmbedBuilder().setColor("#ffaa00").setTitle("Detection Result")
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
      let finalUrl = url
      if (/pastebin\.com\/[^\/]+$/i.test(url) && !url.includes("/raw/")) finalUrl = url.replace("pastebin.com/", "pastebin.com/raw/")
      else if (/gist\.github\.com\/([^\/]+)\/([^\/]+)$/i.test(url)) finalUrl = url + "/raw"
      else if (/github\.com\/([^\/]+)\/([^\/]+)\/blob\/([^\/]+)\/(.+)/i.test(url)) finalUrl = url.replace("/blob/", "/raw/")
      try {
        const res = await fetch(finalUrl)
        const code = await res.text()
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

logger.log("INFO", "Starting...")
client.login(process.env.DISCORD_TOKEN).catch(e => {
  logger.log("ERROR", "Login failed", { error: e.message })
  process.exit(1)
})
