const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const path = require("path");

const {
    Logger,
    Detector,
    VMAnalyzer,
    AntiTamperDetector,
    Deobfuscator,
    fetchCodeFromUrl,
    readAttachment
} = require('./core.js');

const { LuaSandbox } = require('./sandbox.js');
const { PythonBridge } = require('./tools.js');
const { Pipeline } = require('./pipeline.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("Missing DISCORD_TOKEN or CLIENT_ID in environment variables.");
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code from a string").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate Lua code from a URL").addStringOption(o => o.setName("url").setDescription("URL to the obfuscated code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate Lua code from an uploaded file").addAttachmentOption(o => o.setName("file").setDescription("File (.lua/.txt/.luau/.luac)").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("Or a URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("Or a file").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("layers").setDescription("Analyze nested obfuscation layers").addStringOption(o => o.setName("code").setDescription("The obfuscated Lua code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("vmdetect").setDescription("Analyze VM structure").addStringOption(o => o.setName("code").setDescription("The code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("Or URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("Or file").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("help").setDescription("Show available commands").toJSON(),
].map(c => c);

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
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
            .setTitle("📖 God-Mode Deobfuscator V5")
            .setDescription("Advanced Lua deobfuscation engine.")
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
            const embed = new EmbedBuilder()
                .setColor(vm.isVM ? 0xff6600 : 0x00ff88)
                .setTitle("🖥️ VM Structure Analysis")
                .setDescription(`**Source:** ${source}`)
                .addFields(
                    { name: "Is VM", value: vm.isVM ? `YES (${vm.score}/20)` : "No", inline: true },
                    { name: "Family", value: vm.likelyFamily, inline: true },
                    { name: "Anti-Tamper Risk", value: at.riskLevel, inline: true }
                );
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
            const detection = new Detector(code).detect();
            const layerAnalysis = new Detector(code).analyzeLayers(code);
            const embed = new EmbedBuilder()
                .setColor(detection.name === "Clean" ? 0x00ff88 : 0xffaa00)
                .setTitle("🔍 Obfuscation Detection")
                .setDescription(`**Source:** ${source}`)
                .addFields(
                    { name: "Type", value: detection.name, inline: true },
                    { name: "Confidence", value: `${detection.confidence}%`, inline: true },
                    { name: "Layers", value: `${layerAnalysis.layers.length}`, inline: true }
                );
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
            const analysis = new Detector(code).analyzeLayers(code);
            const buffer = Buffer.from(analysis.final, "utf-8");
            await interaction.editReply({
                content: `🧅 **Layers:** ${analysis.layers.length}`,
                files: [new AttachmentBuilder(buffer, { name: "unwrapped.lua" })]
            });
        } catch (error) {
            await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` });
        }
        return;
    }

    if (interaction.commandName === "deobf" || interaction.commandName === "deobf_url" || interaction.commandName === "deobf_file") {
        await interaction.deferReply();
        try {
            const { code, source } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("No code found");
            if (code.length > 500000) throw new Error("Code too large (max 500KB)");

            const quickDetect = new Detector(code).detect();
            const vmInfo = VMAnalyzer.analyze(code);
            const isVM = quickDetect.name === "MoonVeil" ||
                         quickDetect.name === "WeAreDevs" ||
                         vmInfo.isVM ||
                         code.includes("wearedevs.net/obfuscator") ||
                         code.includes("zy28uHLFUuAPgKtOc0AcRNq");

            if (isVM) {
                await interaction.editReply({ content: `⏳ **VM Detected (${quickDetect.name}).** Trying Lua 5.1 Native Engine...` });

                const tempIn = path.join(__dirname, `vm_${Date.now()}.lua`);
                fs.writeFileSync(tempIn, code);
                const wrapperPath = path.join(__dirname, "wrapper.lua");
                let extractedCode = null;
                let extractionSource = null;
                let allCaptures = [];

                try {
                    const r = await PythonBridge.runLua51(tempIn, wrapperPath);
                    allCaptures = r.all || [];
                    if (r.captured && r.captured.payload.length > 30) {
                        extractedCode = r.captured.payload;
                        extractionSource = `Lua51 (${r.captured.kind})`;
                    } else if (r.httpGets && r.httpGets.length > 0) {
                        await interaction.editReply({
                            content: `⚠️ **Lua 5.1 captured HttpGets but no loadstring:**\n\`\`\`\n${r.httpGets.slice(0, 5).join("\n")}\n\`\`\``
                        });
                    } else if (r.errors && r.errors.length > 0) {
                        Logger.log("WARN", "Lua51 errors", { errors: r.errors });
                    }
                } catch (err) {
                    Logger.log("WARN", "Lua51 execution failed", { error: err.message });
                }

                try { fs.unlinkSync(tempIn); } catch (e) {}

                if (!extractedCode) {
                    await interaction.editReply({ content: `⏳ **Lua 5.1 didn't capture. Trying wasmoon Sandbox...**` });
                    try {
                        const sandboxLogs = await LuaSandbox.run(code);
                        const m = sandboxLogs.match(/\[CAPTURE:LOADSTRING\]\n([\s\S]*?)\n\[\/CAPTURE\]/);
                        if (m && m[1].length > 30) {
                            extractedCode = m[1];
                            extractionSource = "wasmoon Sandbox";
                        } else if (sandboxLogs.includes("[SANDBOX_ERROR]")) {
                            const buffer = Buffer.from(sandboxLogs, "utf-8");
                            await interaction.editReply({
                                content: `❌ **Sandbox crashed.** See logs:`,
                                files: [new AttachmentBuilder(buffer, { name: "sandbox_logs.txt" })]
                            });
                            return;
                        } else {
                            const buffer = Buffer.from(sandboxLogs, "utf-8");
                            await interaction.editReply({
                                content: `⚠️ **Sandbox ran but no loadstring captured.** See logs:`,
                                files: [new AttachmentBuilder(buffer, { name: "sandbox_logs.txt" })]
                            });
                            return;
                        }
                    } catch (e) {
                        await interaction.editReply({ content: `❌ Sandbox failed: ${e.message}` });
                        return;
                    }
                }

                if (extractedCode) {
                    const finalDeobf = new Deobfuscator(extractedCode, { beautify: true });
                    await finalDeobf.run();
                    const buffer = Buffer.from(finalDeobf.code, "utf-8");
                    let extra = allCaptures.length > 1 ? `\n📊 **${allCaptures.length} captures found** (showing first)` : "";
                    await interaction.editReply({
                        content: `✅ **Extracted clean code via ${extractionSource}!**${extra}`,
                        files: [new AttachmentBuilder(buffer, { name: "deobfuscated_clean.lua" })]
                    });
                } else {
                    await interaction.editReply({ content: `❌ **VM couldn't be cracked. Likely protected with anti-tamper or C++ VM.**` });
                }
                return;
            }

            await interaction.editReply({ content: `🧠 **Smart Engine working:** analyzing and trying tools in order...` });

            const tempDir = path.join(__dirname, `temp_pipeline_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });

            try {
                const pipelineResult = await Pipeline.runChain(code, tempDir, quickDetect.name);
                fs.rmSync(tempDir, { recursive: true, force: true });

                if (pipelineResult.code) {
                    const finalBuffer = Buffer.from(pipelineResult.code, "utf-8");
                    const finalName = pipelineResult.isClean ? `deobfuscated_clean.lua` : `extracted_data.txt`;
                    const toolText = pipelineResult.tools.join(" ➔ ");
                    const statusMsg = pipelineResult.isClean
                        ? `✅ **Deobfuscation Complete!**\n🧠 Engines: ${toolText}\n✨ Code is clean and beautified.`
                        : `⚠️ **Data extracted but code not 100% clean.**\n🧠 Engines: ${toolText}`;

                    await interaction.editReply({ content: statusMsg });
                    await interaction.editReply({ files: [new AttachmentBuilder(finalBuffer, { name: finalName })] });
                    return;
                }

                await interaction.editReply({ content: `❌ **All tools failed.**` });
            } catch (err) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
                await interaction.editReply({ content: `❌ Internal Error: ${err.message}` });
            }
        } catch (error) {
            Logger.log("ERROR", "Deobfuscation failed", { error: error.message });
            await interaction.editReply({ content: `❌ Deobfuscation Failed: ${error.message.slice(0, 1500)}` });
        }
        return;
    }
});

client.on("error", (error) => Logger.log("ERROR", "Client error", { error: error.message }));
process.on("unhandledRejection", (error) => Logger.log("ERROR", "Unhandled rejection", { error: error?.message || error }));

Logger.log("INFO", "Starting bot V5 God-Mode...");
client.login(TOKEN).catch((error) => {
    Logger.log("ERROR", "Login failed", { error: error.message });
    process.exit(1);
});
