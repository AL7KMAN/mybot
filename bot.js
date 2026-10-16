const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js")
const { REST } = require("@discordjs/rest")
const { Routes } = require("discord-api-types/v9")
const fetch = require("node-fetch")

class Logger {
  static log(level, msg, data = {}) {
    const colors = { INFO: "\x1b[36m", WARN: "\x1b[33m", ERROR: "\x1b[31m", SUCCESS: "\x1b[32m", DEBUG: "\x1b[35m" }
    console.log(`${colors[level] || "\x1b[0m"}[${level}] ${msg}\x1b[0m`, data)
  }
}

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
      const bytes = [Number((v >> 24n) & 0xFFn), Number((v >> 16n) & 0xFFn), Number((v >> 8n) & 0xFFn), Number(v & 0xFFn)]
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

class CustomBase64 {
  static evalLuaExpr(expr) {
    try {
      const cleaned = expr.replace(/\s+/g, "")
      if (!/^[\d+\-*/%().]+$/.test(cleaned)) return null
      const result = Function('"use strict"; return (' + cleaned + ')')()
      if (typeof result !== "number" || !Number.isFinite(result)) return null
      return Math.floor(result)
    } catch (e) { return null }
  }
  static parseValue(val) {
    val = val.trim()
    if (/^-?\d+$/.test(val)) return parseInt(val)
    if (/^0[xX][0-9a-fA-F]+$/.test(val)) return parseInt(val, 16)
    if (/^[\d\s+\-*/%().]+$/.test(val)) return this.evalLuaExpr(val)
    return null
  }
  static extractAlphabets(code) {
    const alphabets = []
    const tableRe = /(?:local\s+)?(\w+)\s*=\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g
    let tableMatch
    while ((tableMatch = tableRe.exec(code)) !== null) {
      const [, name, body] = tableMatch
      const entries = {}
      const entryRe = /(?:\[["']([^"']+)["']\]|\[(\d+)\]|([A-Za-z_]\w*))\s*=\s*([^,}\n]+)/g
      let entryMatch
      while ((entryMatch = entryRe.exec(body)) !== null) {
        const key = entryMatch[1] !== undefined ? entryMatch[1] : entryMatch[2] !== undefined ? entryMatch[2] : entryMatch[3]
        const valStr = entryMatch[4].trim()
        const val = this.parseValue(valStr)
        if (val !== null && val >= 0 && val <= 63 && key && key.length === 1) entries[val] = key
      }
      const keys = Object.keys(entries)
      if (keys.length >= 60 && keys.length <= 68) {
        const alphabet = []
        let ok = true
        for (let i = 0; i < 64; i++) {
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
          alphabet.push(ch)
        }
        if (ok && alphabet.length === 64) alphabets.push({ name, alphabet, entries })
      }
    }
    return alphabets
  }
  static decode(str, alphabet) {
    if (!str || !alphabet || alphabet.length !== 64) return null
    const lookup = {}
    for (let i = 0; i < 64; i++) lookup[alphabet[i]] = i
    const out = []
    let i = 0
    while (i < str.length) {
      const chunk = str.slice(i, i + 4)
      const origLen = chunk.length
      if (origLen === 0) break
      let clean = chunk
      let padding = 0
      while (clean.endsWith("=")) { clean = clean.slice(0, -1); padding++ }
      while (clean.length < 4) clean += alphabet[0]
      let v = 0n
      let valid = true
      for (const c of clean) {
        if (lookup[c] === undefined) { valid = false; break }
        v = v * 64n + BigInt(lookup[c])
      }
      if (!valid) { i += origLen; continue }
      const bytes = [Number((v >> 16n) & 0xFFn), Number((v >> 8n) & 0xFFn), Number(v & 0xFFn)]
      const outCount = 3 - padding
      for (let k = 0; k < outCount; k++) out.push(bytes[k])
      i += origLen
    }
    return Buffer.from(out)
  }
  static findStringTables(code) {
    const tables = []
    const re = /(?:local\s+)?(\w+)\s*=\s*\{([\s\S]*?)\}/g
    let m
    while ((m = re.exec(code)) !== null) {
      const [, name, body] = m
      const strs = []
      const strRe = /"((?:[^"\\]|\\.)*)"/g
      let sm
      while ((sm = strRe.exec(body)) !== null) strs.push(sm[1])
      if (strs.length >= 5 && strs.length < 5000) {
        const allB64 = strs.every(s => /^[A-Za-z0-9+/]+=*$/.test(s) || s === "")
        if (allB64) tables.push({ name, strings: strs, size: strs.length })
      }
    }
    return tables
  }
  static bytesToString(bytes) {
    const str = bytes.toString("utf-8")
    let printable = 0
    for (const c of str) {
      const code = c.charCodeAt(0)
      if (code >= 32 && code <= 126) printable++
    }
    if (str.length > 0 && printable / str.length > 0.7) return { type: "text", value: str }
    return { type: "hex", value: bytes.toString("hex") }
  }
}

class WeAreDevs {
  static ALPHA_V1 = "^W!,tK_PN+C+=WOGJ@d3bL;Zc<Rv8x&m$(q)e]9#-{?f5u:My2B|/z4Y7[h0o*%S6A\\Q._K`X1VITp\"DEURgjFlsnHikw".split("")
  static replaceAll(code, alphabet, prefix) {
    let count = 0
    const esc = prefix === "^" ? "\\^" : prefix
    const re = new RegExp(`"${esc}([^"]{4,})"`, "g")
    const newCode = code.replace(re, (m, encoded) => {
      try {
        const decoded = Base85.decode(encoded, alphabet)
        if (decoded && /^[\x20-\x7E\s]*$/.test(decoded) && decoded.length > 0) {
          count++
          return JSON.stringify(decoded)
        }
      } catch (e) {}
      return m
    })
    return { code: newCode, count }
  }
  static extractStrings(code, alphabet, prefix) {
    const out = []
    const esc = prefix === "^" ? "\\^" : prefix
    const re = new RegExp(`"${esc}([^"]{4,})"`, "g")
    let m
    while ((m = re.exec(code)) !== null) {
      try {
        const decoded = Base85.decode(m[1], alphabet)
        if (decoded && decoded.length > 0) out.push({ encoded: m[1], decoded })
      } catch (e) {}
    }
    return out
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
      const out = []
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
      let b = 0, n = 0
      const out = []
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
    try {
      let r = ""
      for (let i = 0; i < s.length; i += 2) r += String.fromCharCode(parseInt(s.substr(i, 2), 16))
      if (this.isPrintable(r)) return r
    } catch (e) {}
    return null
  }
  static octal(s) {
    if (s.length < 9 || s.length % 3 !== 0) return null
    if (!/^[0-7]+$/.test(s)) return null
    try {
      let r = ""
      for (let i = 0; i < s.length; i += 3) r += String.fromCharCode(parseInt(s.substr(i, 3), 8))
      if (this.isPrintable(r)) return r
    } catch (e) {}
    return null
  }
  static urlDecode(s) {
    if (!s.includes("%")) return null
    try {
      const dec = decodeURIComponent(s)
      if (dec !== s && this.isPrintable(dec)) return dec
    } catch (e) {}
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
      if (this.isPrintable(out) && this.hasLuaKeywords(out)) results.push({ key: "0x" + key.toString(16), sample: out.slice(0, 150), confidence: this.scoreText(out) })
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
  constructor(code) {
    this.code = code
    this.tables = []
    this.totalStrings = 0
  }
  findTables() {
    const patterns = [/local\s+(\w+)\s*=\s*\{([\s\S]*?)\}/g, /(\w+)\s*=\s*\{([\s\S]*?)\}/g]
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

class VMAnalyzer {
  static analyze(code) {
    const info = {
      hasDispatchLoop: /while\s+true\s+do|repeat\s+until\s+false|::\w+::\s*goto/.test(code),
      usesBitOps: /bit32\.(bxor|band|bor|lshift|rshift|bnot)/.test(code),
      usesGetfenv: /\bgetfenv\b|\bsetfenv\b/.test(code),
      usesLoadstring: /\bloadstring\b|\bload\s*\(/.test(code),
      usesNewproxy: /\bnewproxy\b/.test(code),
      usesSetmetatable: /\bsetmetatable\b/.test(code),
      usesUnpack: /\bunpack\b|\btable\.unpack\b/.test(code),
      usesSelect: /\bselect\b/.test(code),
      registerCount: (code.match(/\bR\d+\b/g) || []).length,
      upvalueCount: (code.match(/\bU\d+\b/g) || []).length,
      hexKeyCount: (code.match(/\[0x[0-9a-fA-F]+\]/g) || []).length,
      decimalKeyCount: (code.match(/\[\d{1,5}\]/g) || []).length,
      hasTableWrap: /setmetatable\s*\(\s*\{\s*\[80\]\s*=\s*unpack/.test(code),
      hasLuraphSig: /return\s+setmetatable\s*\(\s*\{\s*\[80\]\s*=/.test(code),
      hasWeAreDevsSig: /wearedevs\.net\/obfuscator/.test(code),
      hasMoonsecSig: /MoonSec_StringsHiddenAttr|MoonSec V3/.test(code),
      hasIronbrewSig: /ironbrew/i.test(code),
      hasLuarmorSig: /luarmor\.net|luraph_runtime1/.test(code),
      hasFuncFactory: /local\s+function\s+\w+\s*\([^)]*\)\s*return\s+function/.test(code),
      hasWhileTrue: /while\s+true\s+do/.test(code),
      hasGoto: /\bgoto\s+\w+/.test(code),
      hasInlineTable: /\{[^{}]*\[[^\]]+\]\s*=\s*[^{}]+\}/.test(code),
      stringCharCount: (code.match(/string\.char/g) || []).length,
      stringByteCount: (code.match(/string\.byte/g) || []).length,
      stringSubCount: (code.match(/string\.sub/g) || []).length,
      tableConcatCount: (code.match(/table\.concat/g) || []).length,
      tableInsertCount: (code.match(/table\.insert/g) || []).length,
    }
    let score = 0
    if (info.hasDispatchLoop) score += 3
    if (info.usesBitOps) score += 2
    if (info.usesGetfenv) score += 2
    if (info.usesLoadstring) score += 1
    if (info.usesNewproxy) score += 2
    if (info.usesSetmetatable) score += 1
    if (info.usesUnpack) score += 1
    if (info.usesSelect) score += 1
    if (info.hasTableWrap) score += 4
    if (info.hasFuncFactory) score += 2
    if (info.stringCharCount > 20) score += 2
    if (info.hexKeyCount > 20) score += 2
    if (info.registerCount > 10) score += 3
    info.isVM = score >= 5
    info.score = score
    info.confidence = Math.min(100, Math.round((score / 20) * 100))
    if (info.hasWeAreDevsSig) info.likelyFamily = "WeAreDevs"
    else if (info.hasLuraphSig) info.likelyFamily = "Luraph"
    else if (info.hasMoonsecSig) info.likelyFamily = "Moonsec"
    else if (info.hasIronbrewSig) info.likelyFamily = "IronBrew"
    else if (info.hasLuarmorSig) info.likelyFamily = "Luarmor"
    else if (info.isVM) info.likelyFamily = "Generic VM"
    else info.likelyFamily = "Unknown"
    return info
  }
}

class AntiTamperDetector {
  static detect(code) {
    const patterns = [
      { name: "debug.getinfo", regex: /debug\.getinfo\s*\(/g, severity: "medium" },
      { name: "debug.sethook", regex: /debug\.sethook\s*\(/g, severity: "high" },
      { name: "debug.traceback", regex: /debug\.traceback\s*\(/g, severity: "low" },
      { name: "debug.getlocal", regex: /debug\.getlocal\s*\(/g, severity: "medium" },
      { name: "debug.getupvalue", regex: /debug\.getupvalue\s*\(/g, severity: "medium" },
      { name: "os.clock guard", regex: /os\.clock\s*\(\s*\)\s*[-+]?\s*\d+/g, severity: "high" },
      { name: "tick guard", regex: /tick\s*\(\s*\)\s*[-+]?\s*\d+/g, severity: "high" },
      { name: "env marker (table key)", regex: /getfenv\s*\(\s*\)\s*\[\s*\w+\s*\]\s*=/g, severity: "high" },
      { name: "global silencing print", regex: /\bprint\s*=\s*function\s*\(\s*\)\s*end/g, severity: "medium" },
      { name: "global silencing error", regex: /\berror\s*=\s*function\s*\(\s*\)\s*end/g, severity: "medium" },
      { name: "while true do end", regex: /while\s+true\s+do\s+end/g, severity: "high" },
      { name: "pcall debug", regex: /pcall\s*\(\s*debug\./g, severity: "medium" },
      { name: "getfenv check", regex: /type\s*\(\s*getfenv\s*\(\s*\)\s*\[/g, severity: "medium" },
      { name: "wall-clock guard", regex: /not\s*\([^)]*or\s*\w+\s*<\s*os\.clock/g, severity: "high" },
      { name: "jobid binding", regex: /game\.JobId/g, severity: "low" },
      { name: "tamper detection", regex: /Hooked|hookfunction|hookmetamethod/g, severity: "medium" },
    ]
    const found = []
    let totalSeverity = 0
    const severityMap = { low: 1, medium: 2, high: 3 }
    for (const p of patterns) {
      const matches = code.match(p.regex)
      if (matches && matches.length > 0) {
        found.push({ name: p.name, count: matches.length, severity: p.severity })
        totalSeverity += severityMap[p.severity] * Math.min(matches.length, 3)
      }
    }
    const riskLevel = totalSeverity >= 15 ? "HIGH" : totalSeverity >= 7 ? "MEDIUM" : totalSeverity >= 2 ? "LOW" : "NONE"
    return { patterns: found, totalSeverity, riskLevel, count: found.length }
  }
}

class Detector {
  constructor(code) {
    this.code = code
  }
  static SIGNATURES = [
    { name: "WeAreDevs", patterns: [/wearedevs\.net\/obfuscator/i, /\[\[ v1\.0\.0 https:\/\/wearedevs/i], weight: 40, confidence: 95 },
    { name: "Luraph v15", patterns: [/Luraph Obfuscator v15/i, /lura\.ph.*v15/i], weight: 40, confidence: 90 },
    { name: "Luraph v14", patterns: [/Luraph Obfuscator v14/i], weight: 40, confidence: 90 },
    { name: "Luraph v13", patterns: [/Luraph Obfuscator v13/i], weight: 35, confidence: 85 },
    { name: "Luraph", patterns: [/luraph/i, /lura\.ph/, /return setmetatable\(\{\[80\]=unpack/i], weight: 20, confidence: 70 },
    { name: "Moonsec V3", patterns: [/MoonSec V3/i, /MoonSec_StringsHiddenAttr/, /This file was protected with MoonSec V3/], weight: 40, confidence: 95 },
    { name: "Moonsec V2", patterns: [/MoonSec V2/i], weight: 30, confidence: 85 },
    { name: "IronBrew 2", patterns: [/ironbrew/i, /newproxy,setmetatable,getmetatable,select/i], weight: 25, confidence: 75 },
    { name: "IronBrew 1", patterns: [/ib1_/i, /IronBrew1/i], weight: 25, confidence: 70 },
    { name: "Prometheus", patterns: [/prometheus/i, /newproxy, setmetatable, getmetatable, select,/], weight: 25, confidence: 75 },
    { name: "Luarmor", patterns: [/luarmor\.net/i, /luraph_runtime1/, /GetTutorialState\("nil nil/i, /ce_like_loadstring_fn/], weight: 40, confidence: 95 },
    { name: "luaobfuscator", patterns: [/luaobfuscator/i, /v0=string\.char;local v1=string\.byte/], weight: 30, confidence: 85 },
    { name: "Boronide", patterns: [/boronide/i], weight: 25, confidence: 75 },
    { name: "Hercules", patterns: [/hercules/i], weight: 25, confidence: 75 },
    { name: "AztupBrew", patterns: [/AztupBrew/i], weight: 25, confidence: 75 },
    { name: "Xen", patterns: [/Xen.*obf/i], weight: 20, confidence: 65 },
    { name: "Krnl", patterns: [/krnl.*obf/i], weight: 20, confidence: 65 },
    { name: "Veil", patterns: [/veil.*obf/i], weight: 20, confidence: 65 },
  ]
  detect() {
    const c = this.code
    const matches = []
    for (const { name, patterns, weight, confidence } of Detector.SIGNATURES) {
      for (const re of patterns) {
        if (re.test(c)) matches.push({ name, weight, confidence, pattern: re.toString().slice(0, 60) })
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
    if (/return\s*\(\s*function\s*\(\s*\.\.\.\s*\)/.test(c)) genericSignals.push("IIFE pattern")
    if (/bit32\.bxor|bit\.bxor/.test(c)) genericSignals.push("XOR ops")
    if (c.length > 30000) genericSignals.push("large code")
    if (c.length > 100000) genericSignals.push("very large (>100KB)")
    return {
      name: best ? best.name : (genericSignals.length > 2 ? "Generic VM" : "Clean"),
      confidence: best ? best.confidence : Math.min(95, genericSignals.length * 15),
      signals: matches.map(m => m.name + " (" + m.pattern + ")").slice(0, 10),
      generic: genericSignals,
    }
  }
  static detectStatic(code) {
    return new Detector(code).detect()
  }
  analyzeLayers(code, maxDepth = 8) {
    const layers = []
    let current = code
    let depth = 0
    while (depth < maxDepth) {
      const detected = Detector.detectStatic(current)
      if (detected.name === "Clean" && detected.generic.length === 0) break
      layers.push({
        depth: depth + 1,
        name: detected.name,
        confidence: detected.confidence,
        lines: current.split("\n").length,
        size: current.length,
        signals: detected.signals,
        generic: detected.generic,
      })
      const probe = new Deobfuscator(current, { beautify: false, maxRecursive: 1 })
      probe.code = current
      probe.stripComments()
      probe.decodeEscapes()
      probe.decodeUnicode()
      probe.decodeBase64Layer()
      probe.decodeHexLayer()
      probe.decodeAscii85Layer()
      probe.decodeStringChar()
      if (probe.code === current || probe.code.length < 50) break
      current = probe.code
      depth++
    }
    return { layers, final: current }
  }
}

class Deobfuscator {
  constructor(code, opts = {}) {
    this.original = code
    this.code = code
    this.opts = opts
    this.maxRecursive = opts.maxRecursive || 8
    this.stats = {
      originalSize: code.length,
      finalSize: 0,
      originalLines: code.split("\n").length,
      finalLines: 0,
      escapesDecoded: 0,
      base64Decoded: 0,
      base32Decoded: 0,
      base58Decoded: 0,
      base91Decoded: 0,
      hexDecoded: 0,
      octalDecoded: 0,
      urlDecoded: 0,
      wearedevsDecoded: 0,
      ascii85Decoded: 0,
      xorDecoded: 0,
      customB64Alphabets: 0,
      customB64Decoded: 0,
      stringsFound: 0,
      stringRefsResolved: 0,
      tablesFound: 0,
      mathSimplified: 0,
      antiDebugRemoved: 0,
      recursivePasses: 0,
      entropy: 0,
      extractedAlphabet: false,
      alphabetPasses: 0,
      isNested: false,
      layerCount: 0,
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
    this.customB64Results = []
    this.layers = []
    this.detection = null
    this.vmInfo = null
    this.antiTamper = null
  }
  async run() {
    this.log.push("started")
    this.detection = this.detector.detect()
    this.log.push(`type: ${this.detection.name} (${this.detection.confidence}%)`)
    this.vmInfo = VMAnalyzer.analyze(this.code)
    this.log.push(`VM score: ${this.vmInfo.score} (isVM: ${this.vmInfo.isVM})`)
    this.antiTamper = AntiTamperDetector.detect(this.code)
    this.log.push(`Anti-tamper: ${this.antiTamper.count} patterns (risk: ${this.antiTamper.riskLevel})`)
    const layerAnalysis = this.detector.analyzeLayers(this.original)
    this.layers = layerAnalysis.layers
    this.stats.isNested = this.layers.length > 1
    this.stats.layerCount = this.layers.length
    if (this.detection.name === "WeAreDevs") {
      this.log.push("WeAreDevs - extracting alphabet")
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
    this.decodeCustomBase64()
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
    this.stats.finalLines = this.code.split("\n").length
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
    this.code = this.code.replace(/\\x([0-9a-fA-F]{2})/g, (m, h) => {
      const c = parseInt(h, 16)
      if (c >= 32 && c <= 126) {
        this.stats.escapesDecoded++
        return String.fromCharCode(c)
      }
      return m
    })
    this.code = this.code.replace(/\\(\d{1,3})/g, (m, d) => {
      const c = parseInt(d, 10)
      if (c >= 32 && c <= 126) {
        this.stats.escapesDecoded++
        return String.fromCharCode(c)
      }
      return m
    })
    if (this.stats.escapesDecoded > before) this.log.push(`escapes: ${this.stats.escapesDecoded - before}`)
  }
  decodeUnicode() {
    this.code = this.code.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => {
      const c = parseInt(h, 16)
      if (c >= 32 && c <= 65535) {
        this.stats.escapesDecoded++
        return String.fromCharCode(c)
      }
      return m
    })
  }
  decodeBase64Layer() {
    const before = this.stats.base64Decoded
    this.code = this.code.replace(/["']([A-Za-z0-9+/]{20,}={0,2})["']/g, (m, b64) => {
      const dec = Decoders.base64(b64)
      if (dec) {
        this.stats.base64Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    this.code = this.code.replace(/["']([A-Za-z0-9_-]{20,}={0,2})["']/g, (m, b64) => {
      const dec = Decoders.base64url(b64)
      if (dec && dec.length > 4) {
        this.stats.base64Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.base64Decoded > before) this.log.push(`base64: ${this.stats.base64Decoded - before}`)
  }
  decodeBase32Layer() {
    const before = this.stats.base32Decoded
    this.code = this.code.replace(/["']([A-Z2-7]{16,}=*)["']/g, (m, b32) => {
      const dec = Decoders.base32(b32)
      if (dec) {
        this.stats.base32Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.base32Decoded > before) this.log.push(`base32: ${this.stats.base32Decoded - before}`)
  }
  decodeBase58Layer() {
    const before = this.stats.base58Decoded
    this.code = this.code.replace(/["']([1-9A-HJ-NP-Za-km-z]{20,})["']/g, (m, b58) => {
      const dec = Decoders.base58(b58)
      if (dec) {
        this.stats.base58Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.base58Decoded > before) this.log.push(`base58: ${this.stats.base58Decoded - before}`)
  }
  decodeBase91Layer() {
    const before = this.stats.base91Decoded
    this.code = this.code.replace(/["']([A-Za-z0-9!#$%&()*+,.\/:;<=>?@\[\]^_`{|}~"]{20,})["']/g, (m, b91) => {
      if (/[а-яА-Я\u0600-\u06FF]/.test(b91)) return m
      const dec = Decoders.base91(b91)
      if (dec && dec.length > 3) {
        this.stats.base91Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.base91Decoded > before) this.log.push(`base91: ${this.stats.base91Decoded - before}`)
  }
  decodeHexLayer() {
    const before = this.stats.hexDecoded
    this.code = this.code.replace(/["']([0-9a-fA-F]{12,})["']/g, (m, h) => {
      const dec = Decoders.hex(h)
      if (dec) {
        this.stats.hexDecoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.hexDecoded > before) this.log.push(`hex: ${this.stats.hexDecoded - before}`)
  }
  decodeOctalLayer() {
    const before = this.stats.octalDecoded
    this.code = this.code.replace(/"(\d{9,})"/g, (m, o) => {
      const dec = Decoders.octal(o)
      if (dec) {
        this.stats.octalDecoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.octalDecoded > before) this.log.push(`octal: ${this.stats.octalDecoded - before}`)
  }
  decodeURLLayer() {
    const before = this.stats.urlDecoded
    this.code = this.code.replace(/["']([^"']*%[0-9a-fA-F]{2}[^"']*)["']/g, (m, s) => {
      const dec = Decoders.urlDecode(s)
      if (dec) {
        this.stats.urlDecoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.urlDecoded > before) this.log.push(`url: ${this.stats.urlDecoded - before}`)
  }
  decodeAscii85Layer() {
    const before = this.stats.ascii85Decoded
    this.code = this.code.replace(/["']([!-u~]{20,})["']/g, (m, s) => {
      if (s.startsWith("^") || s.startsWith("j")) return m
      const dec = Decoders.ascii85(s)
      if (dec) {
        this.stats.ascii85Decoded++
        return JSON.stringify(dec)
      }
      return m
    })
    if (this.stats.ascii85Decoded > before) this.log.push(`ascii85: ${this.stats.ascii85Decoded - before}`)
  }
  decodeStringChar() {
    this.code = this.code.replace(/string\.char\s*\(\s*([0-9,\s+*%\-()xXa-fA-F]+)\s*\)/g, (m, args) => {
      try {
        const nums = args
          .split(/[,\s]+/)
          .map(x => {
            try { return eval(x) } catch { return NaN }
          })
          .filter(n => !isNaN(n) && n >= 0 && n <= 255)
        if (nums.length > 0) {
          const str = String.fromCharCode(...nums)
          if (/^[\x20-\x7E\s]*$/.test(str)) {
            this.stats.escapesDecoded++
            return JSON.stringify(str)
          }
        }
      } catch (e) {}
      return m
    })
  }
  decodeCustomBase64() {
    const alphabets = CustomBase64.extractAlphabets(this.code)
    if (alphabets.length === 0) return
    this.stats.customB64Alphabets = alphabets.length
    this.log.push(`custom base64 alphabets: ${alphabets.length}`)
    const tables = CustomBase64.findStringTables(this.code)
    if (tables.length === 0) return
    this.log.push(`string tables found: ${tables.length}`)
    for (const table of tables) {
      const alphabet = alphabets[0].alphabet
      const decoded = []
      for (const s of table.strings.slice(0, 200)) {
        if (!s) continue
        try {
          const bytes = CustomBase64.decode(s, alphabet)
          if (bytes && bytes.length > 0) {
            const result = CustomBase64.bytesToString(bytes)
            decoded.push({ raw: s, decoded: result.value, type: result.type, length: bytes.length })
            this.stats.customB64Decoded++
          }
        } catch (e) {}
      }
      if (decoded.length > 0) {
        this.customB64Results.push({ tableName: table.name, alphabetName: alphabets[0].name, strings: decoded })
      }
    }
    if (this.stats.customB64Decoded > 0) this.log.push(`custom b64 decoded: ${this.stats.customB64Decoded} strings`)
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
            if (!isNaN(r) && Number.isFinite(r)) {
              this.stats.mathSimplified++
              changed = true
              return String(r)
            }
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
        if (i >= 0 && i < table.strings.length) {
          this.stats.stringRefsResolved++
          return JSON.stringify(table.strings[i])
        }
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
    for (const c of Object.values(freq)) {
      const p = c / len
      e -= p * Math.log2(p)
    }
    this.stats.entropy = parseFloat((e / 8).toFixed(3))
    if (e / 8 > 0.7) this.warnings.push(`High entropy (${this.stats.entropy})`)
  }
  tryRecursiveDecode() {
    let passes = 0
    while (passes < this.maxRecursive) {
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
  }
  beautify() {
    const lines = this.code.split(/\n/).map(l => l.trim()).filter(l => l.length > 0)
    let indent = 0
    const out = []
    for (const line of lines) {
      if (/^(end|else|elseif|until|\)|\})/i.test(line)) indent = Math.max(0, indent - 1)
      out.push("  ".repeat(indent) + line)
      if (/(then|do|function|repeat|else|elseif|\{|\()$/i.test(line) && !/^(else|elseif)/i.test(line)) indent++
    }
    this.code = out.join("\n")
  }
  buildRecommendations() {
    const recs = []
    if (this.stats.isNested) {
      recs.push(`This script has ${this.stats.layerCount} layers. Use /layers to unwrap step by step.`)
    }
    if (this.vmInfo?.isVM) {
      recs.push(`VM structure detected (confidence ${this.vmInfo.confidence}%). Full deobfuscation requires a runtime sandbox.`)
    }
    if (this.antiTamper?.riskLevel === "HIGH") {
      recs.push(`High-risk anti-tamper detected. This script will deadlock or kick in unprotected environments.`)
    }
    if (this.detection.name.includes("Luraph") || this.detection.name.includes("Moonsec") || this.detection.name.includes("Luarmor")) {
      recs.push(`This obfuscator requires specialized tools (Python/C# based). JS-only deobfuscation has limits.`)
    }
    if (this.stats.wearedevsDecoded > 0) {
      recs.push(`WeAreDevs strings decoded. Bytecode layer requires a runtime to fully unwrap.`)
    }
    if (this.detection.name === "Clean") {
      recs.push(`No obfuscation detected. Script is clean.`)
    }
    if (recs.length === 0) {
      recs.push(`Try /deobf_file with a fresh sample, or use /detect to verify the type.`)
    }
    return recs
  }
}

async function fetchCodeFromUrl(url) {
  const fixed = url
    .replace(/github\.com\/([^\/]+)\/([^\/]+)\/blob\//, "raw.githubusercontent.com/$1/$2/")
    .replace(/pastebin\.com\/(?!raw\/)([A-Za-z0-9]+)/, "pastebin.com/raw/$1")
  const response = await fetch(fixed, { headers: { "User-Agent": "Mozilla/5.0" } })
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return await response.text()
}

async function readAttachment(attachment) {
  if (attachment.size > 5 * 1024 * 1024) throw new Error("File too large (max 5MB)")
  const valid = [".lua", ".txt", ".luau", ".luac"]
  if (!valid.some(e => attachment.name.toLowerCase().endsWith(e))) throw new Error("Invalid file type")
  const response = await fetch(attachment.url)
  if (!response.ok) throw new Error(`Download failed: ${response.statusText}`)
  return await response.text()
}

function buildReport(result) {
  let r = "═══════════════════════════════════════════════\n"
  r += "         DEOBFUSCATION REPORT (V7)\n"
  r += "═══════════════════════════════════════════════\n\n"
  r += "🎯 DETECTION\n"
  r += `   Type: ${result.detection.name}\n`
  r += `   Confidence: ${result.detection.confidence}%\n`
  r += `   Nested: ${result.stats.isNested ? "YES (" + result.stats.layerCount + " layers)" : "NO"}\n`
  if (result.detection.signals.length > 0) {
    r += `   Signals: ${result.detection.signals.slice(0, 5).join(", ")}\n`
  }
  if (result.detection.generic.length > 0) {
    r += `   Generic: ${result.detection.generic.join(", ")}\n`
  }
  r += "\n"
  if (result.vmInfo) {
    r += "🖥️ VM ANALYSIS\n"
    r += `   Is VM: ${result.vmInfo.isVM ? "YES ✅" : "No"}\n`
    r += `   Score: ${result.vmInfo.score}/20 (confidence ${result.vmInfo.confidence}%)\n`
    r += `   Family: ${result.vmInfo.likelyFamily}\n`
    r += `   Dispatch Loop: ${result.vmInfo.hasDispatchLoop ? "Yes" : "No"}\n`
    r += `   Bit Ops: ${result.vmInfo.usesBitOps ? "Yes" : "No"}\n`
    r += `   Getfenv: ${result.vmInfo.usesGetfenv ? "Yes" : "No"}\n`
    r += `   Newproxy: ${result.vmInfo.usesNewproxy ? "Yes" : "No"}\n`
    r += `   Register Count: ${result.vmInfo.registerCount}\n`
    r += `   Hex Keys: ${result.vmInfo.hexKeyCount}\n`
    r += `   Function Factory: ${result.vmInfo.hasFuncFactory ? "Yes" : "No"}\n`
    r += "\n"
  }
  if (result.antiTamper) {
    r += "🛡️ ANTI-TAMPER ANALYSIS\n"
    r += `   Risk Level: ${result.antiTamper.riskLevel}\n`
    r += `   Total Patterns: ${result.antiTamper.count}\n`
    for (const p of result.antiTamper.patterns) {
      r += `   [${p.severity.toUpperCase()}] ${p.name} x${p.count}\n`
    }
    r += "\n"
  }
  if (result.layers.length > 0) {
    r += "🧅 LAYER ANALYSIS (ONION)\n"
    for (const layer of result.layers) {
      r += `   Layer ${layer.depth}: ${layer.name} (${layer.confidence}%) - ${layer.lines} lines, ${layer.size} bytes\n`
      if (layer.signals.length > 0) r += `      signals: ${layer.signals.slice(0, 3).join(", ")}\n`
    }
    r += "\n"
  }
  r += "📊 STATISTICS\n"
  r += `   Original: ${result.stats.originalSize} bytes (${result.stats.originalLines} lines)\n`
  r += `   Final:    ${result.stats.finalSize} bytes (${result.stats.finalLines} lines)\n`
  const ratio = ((1 - result.stats.finalSize / result.stats.originalSize) * 100).toFixed(1)
  r += `   Reduced:  ${ratio}%\n`
  r += `   Entropy:  ${result.stats.entropy}\n`
  r += "\n"
  r += "🔓 DECODING RESULTS\n"
  if (result.stats.wearedevsDecoded > 0) r += `   WeAreDevs:    ${result.stats.wearedevsDecoded}\n`
  if (result.stats.base64Decoded > 0) r += `   Base64:       ${result.stats.base64Decoded}\n`
  if (result.stats.base32Decoded > 0) r += `   Base32:       ${result.stats.base32Decoded}\n`
  if (result.stats.base58Decoded > 0) r += `   Base58:       ${result.stats.base58Decoded}\n`
  if (result.stats.base91Decoded > 0) r += `   Base91:       ${result.stats.base91Decoded}\n`
  if (result.stats.hexDecoded > 0) r += `   Hex:          ${result.stats.hexDecoded}\n`
  if (result.stats.octalDecoded > 0) r += `   Octal:        ${result.stats.octalDecoded}\n`
  if (result.stats.urlDecoded > 0) r += `   URL:          ${result.stats.urlDecoded}\n`
  if (result.stats.ascii85Decoded > 0) r += `   Ascii85:      ${result.stats.ascii85Decoded}\n`
  if (result.stats.customB64Decoded > 0) r += `   Custom B64:   ${result.stats.customB64Decoded}\n`
  if (result.stats.escapesDecoded > 0) r += `   Escapes:      ${result.stats.escapesDecoded}\n`
  if (result.stats.stringRefsResolved > 0) r += `   String refs:  ${result.stats.stringRefsResolved}\n`
  if (result.stats.mathSimplified > 0) r += `   Math ops:     ${result.stats.mathSimplified}\n`
  if (result.stats.antiDebugRemoved > 0) r += `   Anti-debug:   ${result.stats.antiDebugRemoved}\n`
  if (result.stats.xorDecoded > 0) r += `   XOR candidates: ${result.stats.xorDecoded}\n`
  r += `   Recursive passes: ${result.stats.recursivePasses}\n`
  if (result.stats.extractedAlphabet) r += `   Alphabet: EXTRACTED (85 chars, ${result.stats.alphabetPasses} passes)\n`
  r += "\n"
  const recs = result.buildRecommendations()
  if (recs.length > 0) {
    r += "💡 RECOMMENDATIONS\n"
    for (const rec of recs) r += `   • ${rec}\n`
    r += "\n"
  }
  if (result.stringTableAnalyzer && result.stringTableAnalyzer.tables.length > 0) {
    r += "📚 STRING TABLES\n"
    for (const t of result.stringTableAnalyzer.tables.slice(0, 10)) {
      r += `   ${t.name}: ${t.strings.length} strings\n`
    }
    r += "\n"
  }
  if (result.wearedevsSamples.length > 0) {
    r += "🔤 WEAREDEVS DECODED SAMPLES\n"
    for (const s of result.wearedevsSamples.slice(0, 15)) {
      const shown = s.decoded.length > 60 ? s.decoded.slice(0, 60) + "..." : s.decoded
      r += `   ${JSON.stringify(shown)}\n`
    }
    r += "\n"
  }
  if (result.customB64Results.length > 0) {
    r += "🔐 CUSTOM BASE64 RESULTS\n"
    for (const tbl of result.customB64Results) {
      r += `   Table: ${tbl.tableName} (alphabet: ${tbl.alphabetName})\n`
      for (const s of tbl.strings.slice(0, 10)) {
        const shown = s.decoded.length > 60 ? s.decoded.slice(0, 60) + "..." : s.decoded
        r += `      [${s.type}] ${JSON.stringify(shown)}\n`
      }
    }
    r += "\n"
  }
  if (result.xorResults.length > 0) {
    r += "🧮 XOR BRUTE FORCE\n"
    for (const x of result.xorResults) {
      for (const r2 of x.results.slice(0, 2)) {
        r += `   [${r2.key}] ${JSON.stringify(r2.sample.slice(0, 80))}\n`
      }
    }
    r += "\n"
  }
  if (result.urls.length > 0) {
    r += "🌐 URLS FOUND\n"
    for (const u of result.urls.slice(0, 10)) r += `   ${u}\n`
    r += "\n"
  }
  if (result.webhooks.length > 0) {
    r += "⚠️ WEBHOOKS FOUND\n"
    for (const w of result.webhooks) r += `   ${w}\n`
    r += "\n"
  }
  if (result.keys.length > 0) {
    r += "🔑 KEYS FOUND\n"
    for (const k of result.keys.slice(0, 10)) r += `   ${k}\n`
    r += "\n"
  }
  if (result.warnings.length > 0) {
    r += "⚠️ WARNINGS\n"
    for (const w of result.warnings) r += `   ${w}\n`
    r += "\n"
  }
  r += "📝 PROCESSING LOG\n"
  for (const l of result.log) r += `   > ${l}\n`
  r += "\n"
  r += "═══════════════════════════════════════════════\n"
  r += "               DEOBFUSCATED CODE\n"
  r += "═══════════════════════════════════════════════\n\n"
  r += result.code
  return r
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] })

const commands = [
  new SlashCommandBuilder()
    .setName("deobf")
    .setDescription("Deobfuscate Lua code from a string")
    .addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true))
    .addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)"))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("deobf_url")
    .setDescription("Deobfuscate Lua code from a URL")
    .addStringOption(o => o.setName("url").setDescription("URL to the obfuscated code").setRequired(true))
    .addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)"))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("deobf_file")
    .setDescription("Deobfuscate Lua code from an uploaded file")
    .addAttachmentOption(o => o.setName("file").setDescription("File (.lua/.txt/.luau/.luac)").setRequired(true))
    .addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)"))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("detect")
    .setDescription("Detect obfuscator type (no deobfuscation)")
    .addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(false))
    .addStringOption(o => o.setName("url").setDescription("Or a URL to the code").setRequired(false))
    .addAttachmentOption(o => o.setName("file").setDescription("Or a file").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("layers")
    .setDescription("Analyze nested obfuscation layers (onion)")
    .addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("vmdetect")
    .setDescription("Analyze VM structure of an obfuscated script")
    .addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(false))
    .addStringOption(o => o.setName("url").setDescription("Or a URL to the code").setRequired(false))
    .addAttachmentOption(o => o.setName("file").setDescription("Or a file").setRequired(false))
    .toJSON(),
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show available commands")
    .toJSON(),
].map(c => c)

async function registerCommands() {
  if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
    Logger.log("ERROR", "Missing DISCORD_TOKEN or CLIENT_ID")
    return
  }
  const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN)
  try {
    Logger.log("INFO", "Registering slash commands...")
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands })
    Logger.log("SUCCESS", "Slash commands registered")
  } catch (error) {
    Logger.log("ERROR", "Failed to register commands", { error: error.message })
  }
}

async function resolveCode(interaction) {
  const codeOpt = interaction.options.getString("code")
  const urlOpt = interaction.options.getString("url")
  const fileOpt = interaction.options.getAttachment("file")
  if (codeOpt) return { code: codeOpt, source: "Direct input" }
  if (urlOpt) return { code: await fetchCodeFromUrl(urlOpt), source: `URL: ${urlOpt}` }
  if (fileOpt) return { code: await readAttachment(fileOpt), source: `File: ${fileOpt.name}` }
  throw new Error("Please provide code, URL, or file")
}

client.once("ready", () => {
  Logger.log("SUCCESS", `Bot online: ${client.user.tag}`)
  Logger.log("INFO", `Serving ${client.guilds.cache.size} server(s)`)
  registerCommands()
})

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return

  if (interaction.commandName === "help") {
    const embed = new EmbedBuilder()
      .setColor(0x00aaff)
      .setTitle("📖 Deobfuscator Bot V7")
      .setDescription("Advanced Lua deobfuscation with VM analysis, anti-tamper detection, and nested-layer support")
      .addFields(
        { name: "/deobf code:<code>", value: "Deobfuscate code directly" },
        { name: "/deobf_url url:<link>", value: "Deobfuscate from URL (Pastebin/GitHub/Gist)" },
        { name: "/deobf_file file:<file>", value: "Deobfuscate from uploaded file" },
        { name: "/detect", value: "Detect obfuscator type + line count + nested layers" },
        { name: "/layers code:<code>", value: "Analyze nested obfuscation (onion)" },
        { name: "/vmdetect", value: "Analyze VM structure + anti-tamper patterns" },
        { name: "/help", value: "Show this message" },
        { name: "✨ V7 Features", value: "• VM structure analyzer\n• Anti-tamper detector\n• Nested layer (onion) analysis\n• WeAreDevs multi-alphabet\n• Smart recommendations\n• 18+ obfuscator detection\n• 16+ encodings decoded" }
      )
      .setFooter({ text: "V7 • Advanced" })
    await interaction.reply({ embeds: [embed] })
    return
  }

  if (interaction.commandName === "vmdetect") {
    await interaction.deferReply()
    try {
      const { code, source } = await resolveCode(interaction)
      const vm = VMAnalyzer.analyze(code)
      const at = AntiTamperDetector.detect(code)

      const color = vm.isVM ? 0xff6600 : 0x00ff88
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("🖥️ VM Structure Analysis")
        .setDescription(`**Source:** ${source}`)
        .addFields(
          { name: "🤖 Is VM", value: vm.isVM ? `**YES** (score ${vm.score}/20)` : "No", inline: true },
          { name: "🎚️ Confidence", value: `${vm.confidence}%`, inline: true },
          { name: "👨‍👩‍👧 Family", value: vm.likelyFamily, inline: true },
        )
      const structure = []
      if (vm.hasDispatchLoop) structure.push("• Dispatch Loop")
      if (vm.usesBitOps) structure.push("• Bit32 operations")
      if (vm.usesGetfenv) structure.push("• getfenv/setfenv")
      if (vm.usesLoadstring) structure.push("• loadstring/load")
      if (vm.usesNewproxy) structure.push("• newproxy")
      if (vm.usesSetmetatable) structure.push("• setmetatable")
      if (vm.usesUnpack) structure.push("• unpack")
      if (vm.usesSelect) structure.push("• select")
      if (vm.hasFuncFactory) structure.push("• Function factory pattern")
      if (vm.hasTableWrap) structure.push("• Table wrapper [80]")
      if (vm.hasGoto) structure.push("• Goto/Labels")
      if (structure.length > 0) {
        embed.addFields({ name: "🔍 Detected Constructs", value: structure.join("\n").slice(0, 1000) })
      }
      const counts = []
      if (vm.registerCount > 0) counts.push(`Registers: ${vm.registerCount}`)
      if (vm.hexKeyCount > 0) counts.push(`Hex Keys: ${vm.hexKeyCount}`)
      if (vm.decimalKeyCount > 0) counts.push(`Decimal Keys: ${vm.decimalKeyCount}`)
      if (vm.stringCharCount > 0) counts.push(`string.char: ${vm.stringCharCount}`)
      if (vm.stringByteCount > 0) counts.push(`string.byte: ${vm.stringByteCount}`)
      if (vm.stringSubCount > 0) counts.push(`string.sub: ${vm.stringSubCount}`)
      if (vm.tableConcatCount > 0) counts.push(`table.concat: ${vm.tableConcatCount}`)
      if (counts.length > 0) {
        embed.addFields({ name: "📊 Counts", value: counts.join(" • ").slice(0, 1000) })
      }
      if (at.count > 0) {
        const atText = at.patterns.map(p => `[${p.severity.toUpperCase()}] ${p.name} × ${p.count}`).join("\n")
        embed.addFields({ name: `🛡️ Anti-Tamper (Risk: ${at.riskLevel})`, value: atText.slice(0, 1000) })
      } else {
        embed.addFields({ name: "🛡️ Anti-Tamper", value: "No patterns detected ✅" })
      }
      embed.setTimestamp().setFooter({ text: "V7 VM Analyzer" })
      await interaction.editReply({ embeds: [embed] })
    } catch (error) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` })
    }
    return
  }

  if (interaction.commandName === "detect") {
    await interaction.deferReply()
    try {
      const { code, source } = await resolveCode(interaction)
      const detector = new Detector(code)
      const detection = detector.detect()
      const lines = code.split("\n").length
      const bytes = code.length
      const layerAnalysis = detector.analyzeLayers(code)
      const vm = VMAnalyzer.analyze(code)

      const embed = new EmbedBuilder()
        .setColor(detection.name === "Clean" ? 0x00ff88 : 0xffaa00)
        .setTitle("🔍 Obfuscation Detection")
        .setDescription(`**Source:** ${source}`)
        .addFields(
          { name: "🎯 Type", value: detection.name, inline: true },
          { name: "🎚️ Confidence", value: `${detection.confidence}%`, inline: true },
          { name: "📊 Lines", value: `${lines.toLocaleString()}`, inline: true },
          { name: "💾 Size", value: `${bytes.toLocaleString()} bytes`, inline: true },
          { name: "🧅 Nested Layers", value: layerAnalysis.layers.length > 1 ? `**YES** (${layerAnalysis.layers.length} layers)` : "No", inline: true },
          { name: "🖥️ VM", value: vm.isVM ? `**YES** (${vm.confidence}%)` : "No", inline: true },
        )
      if (detection.signals.length > 0) {
        embed.addFields({ name: "🔖 Matched Signatures", value: detection.signals.slice(0, 8).map(s => `• ${s}`).join("\n").slice(0, 1000) })
      }
      if (detection.generic.length > 0) {
        embed.addFields({ name: "🧩 Generic Signals", value: detection.generic.map(s => `• ${s}`).join("\n").slice(0, 1000) })
      }
      if (layerAnalysis.layers.length > 1) {
        const layerText = layerAnalysis.layers.map(l => `**Layer ${l.depth}:** ${l.name} (${l.confidence}%) — ${l.lines} lines`).join("\n")
        embed.addFields({ name: "🧅 Onion Layers", value: layerText.slice(0, 1000) })
      }
      embed.setTimestamp().setFooter({ text: "V7 Detection Engine" })
      await interaction.editReply({ embeds: [embed] })
    } catch (error) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` })
    }
    return
  }

  if (interaction.commandName === "layers") {
    await interaction.deferReply()
    try {
      const code = interaction.options.getString("code")
      const detector = new Detector(code)
      const analysis = detector.analyzeLayers(code)

      const embed = new EmbedBuilder()
        .setColor(0x9933ff)
        .setTitle("🧅 Nested Layer Analysis (Onion)")
        .addFields(
          { name: "🔢 Total Layers", value: `${analysis.layers.length}`, inline: true },
          { name: "📊 Original", value: `${code.length.toLocaleString()} bytes`, inline: true },
          { name: "📉 Final", value: `${analysis.final.length.toLocaleString()} bytes`, inline: true },
        )
      if (analysis.layers.length === 0) {
        embed.setDescription("No obfuscation layers detected — code appears clean.")
      } else {
        const layerText = analysis.layers.map(l => {
          const sigs = l.signals.length > 0 ? `\n   _${l.signals.slice(0, 2).join(", ")}_` : ""
          return `**Layer ${l.depth}:** ${l.name} (${l.confidence}%)\n   📊 ${l.lines} lines • ${l.size.toLocaleString()} bytes${sigs}`
        }).join("\n\n")
        embed.setDescription(layerText.slice(0, 4000))
      }
      const buffer = Buffer.from(analysis.final, "utf-8")
      const attachment = new AttachmentBuilder(buffer, { name: "unwrapped.lua" })
      embed.setTimestamp().setFooter({ text: "V7 Onion Engine" })
      await interaction.editReply({ embeds: [embed], files: [attachment] })
    } catch (error) {
      await interaction.editReply({ content: `❌ Error: ${error.message}` })
    }
    return
  }

  if (interaction.commandName === "deobf" || interaction.commandName === "deobf_url" || interaction.commandName === "deobf_file") {
    await interaction.deferReply()
    const startTime = Date.now()
    try {
      const { code, source } = await resolveCode(interaction)
      if (!code || code.trim().length === 0) throw new Error("No code found")
      if (code.length > 500000) throw new Error("Code too large (max 500KB)")

      const beautify = interaction.options.getBoolean("beautify") !== false
      const deobf = new Deobfuscator(code, { beautify })
      await deobf.run()

      const elapsed = Date.now() - startTime
      const ratio = ((1 - deobf.stats.finalSize / deobf.stats.originalSize) * 100).toFixed(1)

      const embed = new EmbedBuilder()
        .setColor(deobf.stats.isNested ? 0x9933ff : 0x00ff88)
        .setTitle("🚀 Deobfuscation Complete (V7)")
        .setDescription(`**Source:** ${source}`)
        .addFields(
          { name: "🎯 Type", value: deobf.detection.name, inline: true },
          { name: "🎚️ Confidence", value: `${deobf.detection.confidence}%`, inline: true },
          { name: "🧅 Layers", value: deobf.stats.isNested ? `${deobf.stats.layerCount}` : "1", inline: true },
          { name: "🖥️ VM", value: deobf.vmInfo?.isVM ? `Yes (${deobf.vmInfo.confidence}%)` : "No", inline: true },
          { name: "🛡️ Anti-Tamper", value: deobf.antiTamper?.riskLevel || "NONE", inline: true },
          { name: "⚡ Reduced", value: `${ratio}%`, inline: true },
          { name: "📊 Original", value: `${deobf.stats.originalLines.toLocaleString()} lines\n${deobf.stats.originalSize.toLocaleString()} bytes`, inline: true },
          { name: "📉 Final", value: `${deobf.stats.finalLines.toLocaleString()} lines\n${deobf.stats.finalSize.toLocaleString()} bytes`, inline: true },
          { name: "⏱️ Time", value: `${elapsed}ms`, inline: true },
        )
      const decoders = []
      if (deobf.stats.wearedevsDecoded > 0) decoders.push(`WeAreDevs: ${deobf.stats.wearedevsDecoded}`)
      if (deobf.stats.base64Decoded > 0) decoders.push(`Base64: ${deobf.stats.base64Decoded}`)
      if (deobf.stats.base32Decoded > 0) decoders.push(`Base32: ${deobf.stats.base32Decoded}`)
      if (deobf.stats.base58Decoded > 0) decoders.push(`Base58: ${deobf.stats.base58Decoded}`)
      if (deobf.stats.base91Decoded > 0) decoders.push(`Base91: ${deobf.stats.base91Decoded}`)
      if (deobf.stats.hexDecoded > 0) decoders.push(`Hex: ${deobf.stats.hexDecoded}`)
      if (deobf.stats.octalDecoded > 0) decoders.push(`Octal: ${deobf.stats.octalDecoded}`)
      if (deobf.stats.urlDecoded > 0) decoders.push(`URL: ${deobf.stats.urlDecoded}`)
      if (deobf.stats.ascii85Decoded > 0) decoders.push(`Ascii85: ${deobf.stats.ascii85Decoded}`)
      if (deobf.stats.customB64Decoded > 0) decoders.push(`CustomB64: ${deobf.stats.customB64Decoded}`)
      if (deobf.stats.escapesDecoded > 0) decoders.push(`Escapes: ${deobf.stats.escapesDecoded}`)
      if (deobf.stats.stringRefsResolved > 0) decoders.push(`StringRefs: ${deobf.stats.stringRefsResolved}`)
      if (deobf.stats.mathSimplified > 0) decoders.push(`Math: ${deobf.stats.mathSimplified}`)
      if (deobf.stats.antiDebugRemoved > 0) decoders.push(`AntiDebug: ${deobf.stats.antiDebugRemoved}`)
      if (deobf.stats.xorDecoded > 0) decoders.push(`XOR: ${deobf.stats.xorDecoded}`)
      if (deobf.stats.extractedAlphabet) decoders.push(`Alphabet: extracted`)
      if (decoders.length > 0) {
        embed.addFields({ name: "🔓 Decoded", value: decoders.join(" • ").slice(0, 1000) })
      }
      if (deobf.stats.isNested && deobf.layers.length > 0) {
        const layerText = deobf.layers.map(l => `L${l.depth}: ${l.name} (${l.confidence}%)`).join(" → ")
        embed.addFields({ name: "🧅 Layer Chain", value: layerText.slice(0, 1000) })
      }
      const recs = deobf.buildRecommendations()
      if (recs.length > 0) {
        embed.addFields({ name: "💡 Recommendations", value: recs.slice(0, 5).map(r => `• ${r}`).join("\n").slice(0, 1000) })
      }
      if (deobf.webhooks.length > 0) {
        embed.addFields({ name: "⚠️ Webhooks", value: deobf.webhooks.slice(0, 3).map(w => `\`${w.slice(0, 80)}\``).join("\n").slice(0, 1000) })
      }
      if (deobf.keys.length > 0) {
        embed.addFields({ name: "🔑 Possible Keys", value: deobf.keys.slice(0, 5).map(k => `\`${k}\``).join("\n").slice(0, 1000) })
      }
      embed.addFields({ name: "📈 Entropy", value: `${deobf.stats.entropy}`, inline: true })
      embed.setTimestamp().setFooter({ text: "V7 • Advanced Deobfuscation" })

      const report = buildReport(deobf)
      const buffer = Buffer.from(report, "utf-8")
      const attachment = new AttachmentBuilder(buffer, { name: "deobfuscated.txt" })

      await interaction.editReply({ embeds: [embed], files: [attachment] })
    } catch (error) {
      Logger.log("ERROR", "Deobfuscation failed", { error: error.message })
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("❌ Deobfuscation Failed")
        .setDescription(`**Error:** ${error.message}`)
        .setTimestamp()
      await interaction.editReply({ embeds: [embed] })
    }
    return
  }
})

client.on("error", (error) => Logger.log("ERROR", "Client error", { error: error.message }))
process.on("unhandledRejection", (error) => Logger.log("ERROR", "Unhandled rejection", { error: error?.message || error }))

if (!process.env.DISCORD_TOKEN) {
  Logger.log("ERROR", "DISCORD_TOKEN missing")
  process.exit(1)
}
if (!process.env.CLIENT_ID) {
  Logger.log("ERROR", "CLIENT_ID missing")
  process.exit(1)
}

Logger.log("INFO", "Starting bot V7...")
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  Logger.log("ERROR", "Login failed", { error: error.message })
  process.exit(1)
})
