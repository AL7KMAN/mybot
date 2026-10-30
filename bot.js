const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const path = require("path");

const {
    Logger,
    PythonBridge,
    LuaSandbox,
    Detector,
    VMAnalyzer,
    Deobfuscator,
    fetchCodeFromUrl,
    readAttachment,
    buildReport
} = require('./engines.js');

const TOKEN = 'MTU2MDU0NDcxNjkwNTI1MDg1Ng.GoIxPo.8ExoHSErpuhAb3-K5nff_tGf8v0v1oeQZswaHA';
const CLIENT_ID = '1560544716905250856';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code from a string").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true)).addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)")).toJSON(),
    new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate Lua code from a URL").addStringOption(o => o.setName("url").setDescription("URL to the obfuscated code").setRequired(true)).addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)")).toJSON(),
    new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate Lua code from an uploaded file").addAttachmentOption(o => o.setName("file").setDescription("File (.lua/.txt/.luau/.luac)").setRequired(true)).addBooleanOption(o => o.setName("beautify").setDescription("Format the output (default: true)")).toJSON(),
    new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type (no deobfuscation)").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("Or a URL to the code").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("Or a file").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("layers").setDescription("Analyze nested obfuscation layers (onion)").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("vmdetect").setDescription("Analyze VM structure of an obfuscated script").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("Or a URL to the code").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("Or a file").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("help").setDescription("Show available commands").toJSON(),
].map(c => c);

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        Logger.log("INFO", "Registering slash commands...");
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        Logger.log("SUCCESS", "Slash commands registered");
    } catch (error) {
        Logger.log("ERROR", "Failed to register commands", { error: error.message });
    }
}

async function resolveCode(interaction) {
    const codeOpt = interaction.options.getString("code");
    const urlOpt = interaction.options.getString("url");
    const fileOpt = interaction.options.getAttachment("file");
    if (codeOpt) return { code: codeOpt, source: "Direct input" };
    if (urlOpt) return { code: await fetchCodeFromUrl(urlOpt), source: `URL: ${urlOpt}` };
    if (fileOpt) return { code: await readAttachment(fileOpt), source: `File: ${fileOpt.name}` };
    throw new Error("Please provide code, URL, or file");
}

client.once("ready", () => {
    Logger.log("SUCCESS", `Bot online: ${client.user.tag}`);
    Logger.log("INFO", `Serving ${client.guilds.cache.size} server(s)`);
    registerCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder()
            .setColor(0x00aaff)
            .setTitle("📖 God-Mode Deobfuscator V4")
            .setDescription("Advanced Lua deobfuscation engine. Just send me a URL or a File and I'll send you the deobfuscated code directly.")
            .addFields(
                { name: "/deobf_url url:<link>", value: "Deobfuscate from URL" },
                { name: "/deobf_file file:<file>", value: "Deobfuscate from uploaded file" },
                { name: "/deobf code:<code>", value: "Deobfuscate code directly" },
                { name: "/detect", value: "Detect obfuscator type" },
                { name: "/layers", value: "Analyze nested obfuscation" },
                { name: "/vmdetect", value: "Analyze VM structure" }
            );
        await interaction.reply({ embeds: [embed] });
        return;
    }

    if (interaction.commandName === "vmdetect") {
        await interaction.deferReply();
        try {
            const { code, source } = await resolveCode(interaction);
            const vm = VMAnalyzer.analyze(code);
            const at = AntiTamperDetector.detect(code);

            const color = vm.isVM ? 0xff6600 : 0x00ff88;
            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle("🖥️ VM Structure Analysis")
                .setDescription(`**Source:** ${source}`)
                .addFields(
                    { name: "🤖 Is VM", value: vm.isVM ? `**YES** (score ${vm.score}/20)` : "No", inline: true },
                    { name: "🎚️ Confidence", value: `${vm.confidence}%`, inline: true },
                    { name: "👨‍👩‍👧 Family", value: vm.likelyFamily, inline: true },
                );
            const structure = [];
            if (vm.hasDispatchLoop) structure.push("• Dispatch Loop");
            if (vm.usesBitOps) structure.push("• Bit32 operations");
            if (vm.usesGetfenv) structure.push("• getfenv/setfenv");
            if (vm.usesLoadstring) structure.push("• loadstring/load");
            if (vm.usesNewproxy) structure.push("• newproxy");
            if (vm.usesSetmetatable) structure.push("• setmetatable");
            if (vm.usesUnpack) structure.push("• unpack");
            if (vm.usesSelect) structure.push("• select");
            if (vm.hasFuncFactory) structure.push("• Function factory pattern");
            if (vm.hasTableWrap) structure.push("• Table wrapper [80]");
            if (vm.hasGoto) structure.push("• Goto/Labels");
            if (structure.length > 0) embed.addFields({ name: "🔍 Detected Constructs", value: structure.join("\n").slice(0, 1000) });
            const counts = [];
            if (vm.registerCount > 0) counts.push(`Registers: ${vm.registerCount}`);
            if (vm.hexKeyCount > 0) counts.push(`Hex Keys: ${vm.hexKeyCount}`);
            if (vm.decimalKeyCount > 0) counts.push(`Decimal Keys: ${vm.decimalKeyCount}`);
            if (vm.stringCharCount > 0) counts.push(`string.char: ${vm.stringCharCount}`);
            if (vm.stringByteCount > 0) counts.push(`string.byte: ${vm.stringByteCount}`);
            if (vm.stringSubCount > 0) counts.push(`string.sub: ${vm.stringSubCount}`);
            if (vm.tableConcatCount > 0) counts.push(`table.concat: ${vm.tableConcatCount}`);
            if (counts.length > 0) embed.addFields({ name: "📊 Counts", value: counts.join(" • ").slice(0, 1000) });
            if (at.count > 0) {
                const atText = at.patterns.map(p => `[${p.severity.toUpperCase()}] ${p.name} × ${p.count}`).join("\n");
                embed.addFields({ name: `🛡️ Anti-Tamper (Risk: ${at.riskLevel})`, value: atText.slice(0, 1000) });
            } else {
                embed.addFields({ name: "🛡️ Anti-Tamper", value: "No patterns detected ✅" });
            }
            embed.setTimestamp().setFooter({ text: "V4 VM Analyzer" });
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` });
        }
        return;
    }

    if (interaction.commandName === "detect") {
        await interaction.deferReply();
        try {
            const { code, source } = await resolveCode(interaction);
            const detector = new Detector(code);
            const detection = detector.detect();
            const lines = code.split("\n").length;
            const bytes = code.length;
            const layerAnalysis = detector.analyzeLayers(code);
            const vm = VMAnalyzer.analyze(code);

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
                );
            if (detection.signals.length > 0) embed.addFields({ name: "🔖 Matched Signatures", value: detection.signals.slice(0, 8).map(s => `• ${s}`).join("\n").slice(0, 1000) });
            if (detection.generic.length > 0) embed.addFields({ name: "🧩 Generic Signals", value: detection.generic.map(s => `• ${s}`).join("\n").slice(0, 1000) });
            if (layerAnalysis.layers.length > 1) {
                const layerText = layerAnalysis.layers.map(l => `**Layer ${l.depth}:** ${l.name} (${l.confidence}%) — ${l.lines} lines`).join("\n");
                embed.addFields({ name: "🧅 Onion Layers", value: layerText.slice(0, 1000) });
            }
            embed.setTimestamp().setFooter({ text: "V4 Detection Engine" });
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` });
        }
        return;
    }

    if (interaction.commandName === "layers") {
        await interaction.deferReply();
        try {
            const code = interaction.options.getString("code");
            const detector = new Detector(code);
            const analysis = detector.analyzeLayers(code);

            const embed = new EmbedBuilder()
                .setColor(0x9933ff)
                .setTitle("🧅 Nested Layer Analysis (Onion)")
                .addFields(
                    { name: "🔢 Total Layers", value: `${analysis.layers.length}`, inline: true },
                    { name: "📊 Original", value: `${code.length.toLocaleString()} bytes`, inline: true },
                    { name: "📉 Final", value: `${analysis.final.length.toLocaleString()} bytes`, inline: true },
                );
            if (analysis.layers.length === 0) {
                embed.setDescription("No obfuscation layers detected — code appears clean.");
            } else {
                const layerText = analysis.layers.map(l => {
                    const sigs = l.signals.length > 0 ? `\n   _${l.signals.slice(0, 2).join(", ")}_` : "";
                    return `**Layer ${l.depth}:** ${l.name} (${l.confidence}%)\n   📊 ${l.lines} lines • ${l.size.toLocaleString()} bytes${sigs}`;
                }).join("\n\n");
                embed.setDescription(layerText.slice(0, 4000));
            }
            const buffer = Buffer.from(analysis.final, "utf-8");
            const attachment = new AttachmentBuilder(buffer, { name: "unwrapped.lua" });
            embed.setTimestamp().setFooter({ text: "V4 Onion Engine" });
            await interaction.editReply({ embeds: [embed], files: [attachment] });
        } catch (error) {
            await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` });
        }
        return;
    }

    if (interaction.commandName === "deobf" || interaction.commandName === "deobf_url" || interaction.commandName === "deobf_file") {
        await interaction.deferReply();
        const startTime = Date.now();
        try {
            const { code, source } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("No code found");
            if (code.length > 500000) throw new Error("Code too large (max 500KB)");

            const quickDetect = new Detector(code).detect();
            const vmInfo = VMAnalyzer.analyze(code);

            let toolUsed = null;
            if (quickDetect.name === "WeAreDevs" || code.includes("wearedevs.net/obfuscator")) toolUsed = "wearedevs";
            else if (quickDetect.name === "Moonsec V3" || quickDetect.name === "Moonsec V2" || code.includes("MoonSec")) toolUsed = "moonsec";
            else if (quickDetect.name === "Prometheus" || code.includes("Prometheus")) toolUsed = "prometheus";

            if (toolUsed) {
                await interaction.editReply({ content: `🎯 **تم التعرف على التشفير:** ${quickDetect.name}\n⏳ جاري تشغيل أداة **${toolUsed}** لفك التشفير بالكامل...` });
                try {
                    const tempIn = path.join(__dirname, `temp_${Date.now()}.lua`);
                    fs.writeFileSync(tempIn, code);
                    
                    let resultCode = await PythonBridge.run(toolUsed, tempIn);
                    try { fs.unlinkSync(tempIn); } catch (e) {}
                    
                    let finalBuffer = Buffer.from(resultCode, "utf-8");
                    let finalName = `deobfuscated_${toolUsed}.lua`;
                    
                    if (resultCode.startsWith("BYTECODE_HEX:")) {
                        const luacBuffer = Buffer.from(resultCode.replace("BYTECODE_HEX:", ""), "hex");
                        const luacPath = path.join(__dirname, `temp_${Date.now()}.luac`);
                        fs.writeFileSync(luacPath, luacBuffer);
                        
                        try {
                            const unluacCode = await PythonBridge.runUnluac(luacPath);
                            finalBuffer = Buffer.from(unluacCode, "utf-8");
                            finalName = `deobfuscated_${toolUsed}_source.lua`;
                            await interaction.editReply({ content: `✅ **تم فك التشفير بنجاح!**\n🎯 النوع: ${quickDetect.name}\n🔓 الأداة: ${toolUsed} + unluac` });
                        } catch (e) {
                            Logger.log("WARN", "unluac failed, sending raw bytecode", { error: e.message });
                            finalBuffer = luacBuffer;
                            finalName = `deobfuscated_${toolUsed}.luac`;
                            await interaction.editReply({ content: `✅ **تم استخراج الـ Bytecode بنجاح!** (تعذر تحويله لكود لوا)` });
                        }
                        try { fs.unlinkSync(luacPath); } catch (e) {}
                    } else {
                        await interaction.editReply({ content: `✅ **تم فك التشفير بنجاح!**\n🎯 النوع: ${quickDetect.name}\n🔓 الأداة: ${toolUsed}` });
                    }

                    await interaction.editReply({ files: [new AttachmentBuilder(finalBuffer, { name: finalName })] });
                    return;

                } catch (error) {
                    Logger.log("ERROR", `Tool ${toolUsed} failed`, { error: error.message });
                    await interaction.editReply({ content: `⚠️ أداة ${toolUsed} فشلت. جاري التحويل للمحرك الاحتياطي...` });
                }
            }

            if (quickDetect.name === "MoonVeil" || vmInfo.isVM || code.includes("MoonVeil")) {
                await interaction.editReply({ content: `⏳ **VM Detected**. Running inside Lua Sandbox...` });
                const sandboxLogs = await LuaSandbox.run(code);
                await interaction.editReply({ content: `✅ Sandbox Extraction Complete.`, files: [new AttachmentBuilder(Buffer.from(sandboxLogs), { name: "sandbox_logs.txt" })] });
                return;
            }

            const beautify = interaction.options.getBoolean("beautify") !== false;
            const deobf = new Deobfuscator(code, { beautify });
            await deobf.run();

            const elapsed = Date.now() - startTime;
            const report = buildReport(deobf);
            const buffer = Buffer.from(report, "utf-8");
            const attachment = new AttachmentBuilder(buffer, { name: "deobfuscated.txt" });

            const summary = `✅ **Deobfuscation Complete (JS Engine)**\n🎯 Type: **${deobf.detection.name}** (${deobf.detection.confidence}%)\n🔓 Math Ops: **${deobf.stats.mathSimplified}**\n⏱️ Time: **${elapsed}ms**`;

            await interaction.editReply({ content: summary, files: [attachment] });

        } catch (error) {
            Logger.log("ERROR", "Deobfuscation failed", { error: error.message });
            await interaction.editReply({ content: `❌ Deobfuscation Failed: ${error.message.slice(0, 1500)}` });
        }
        return;
    }
});

client.on("error", (error) => Logger.log("ERROR", "Client error", { error: error.message }));
process.on("unhandledRejection", (error) => Logger.log("ERROR", "Unhandled rejection", { error: error?.message || error }));

Logger.log("INFO", "Starting bot V4 God-Mode...");
client.login(TOKEN).catch((error) => {
    Logger.log("ERROR", "Login failed", { error: error.message });
    process.exit(1);
});
