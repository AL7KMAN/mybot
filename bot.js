const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const path = require("path");

const { Logger, Detector, VMAnalyzer, AntiTamperDetector, Deobfuscator, fetchCodeFromUrl, readAttachment } = require('./core.js');
const { PythonBridge } = require('./tools.js');
const { MoonsecBridge } = require('./moonsec.js');
const { Pipeline } = require('./pipeline.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("CRITICAL: Missing DISCORD_TOKEN or CLIENT_ID.");
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code directly").addStringOption(o => o.setName("code").setDescription("The obfuscated code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate Lua code from a URL").addStringOption(o => o.setName("url").setDescription("URL to raw script").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate Lua code from a file").addAttachmentOption(o => o.setName("file").setDescription("File (.lua/.txt)").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("layers").setDescription("Analyze nested onion layers").addStringOption(o => o.setName("code").setDescription("Code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("vmdetect").setDescription("Analyze VM structure").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("help").setDescription("Show commands").toJSON(),
].map(c => c);

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        Logger.log("SUCCESS", "Slash commands registered.");
    } catch (error) {
        Logger.log("ERROR", "Failed to register commands", { error: error.message });
    }
}

async function resolveCode(interaction) {
    const codeOpt = interaction.options.getString("code");
    const urlOpt = interaction.options.getString("url");
    const fileOpt = interaction.options.getAttachment("file");
    if (codeOpt) return { code: codeOpt, source: "Direct Input" };
    if (urlOpt) return { code: await fetchCodeFromUrl(urlOpt), source: "URL" };
    if (fileOpt) return { code: await readAttachment(fileOpt), source: "File" };
    throw new Error("You must provide code, a URL, or a file.");
}

function extractUrls(text) {
    const urls = text.match(/https?:\/\/[^\s"'`]+/g) || [];
    return [...new Set(urls)].filter(u => u.length > 10 && u.length < 250).slice(0, 20);
}

async function handleWeAreDevs(interaction, code) {
    await interaction.editReply({ content: "⏳ **WeAreDevs Detected.** Running Prometheus (pdeobf.js)..." });

    const tempDir = path.join(__dirname, `wd_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);

    try {
        const rawResult = await PythonBridge.run("wearedevs", tempIn);

        if (typeof rawResult !== "string" || rawResult.length < 50) {
            return interaction.editReply({
                content: `❌ **WeAreDevs failed.** PythonBridge returned: \`${String(rawResult).slice(0, 400)}\``
            });
        }

        let finalCode = rawResult;
        try {
            const finalDeobf = new Deobfuscator(rawResult, { beautify: true });
            await finalDeobf.run();
            if (finalDeobf.code && finalDeobf.code.length > 50) {
                finalCode = finalDeobf.code;
            }
        } catch (deobfErr) {
            Logger.log("WARN", "Deobfuscator cleanup failed, using raw result", { error: deobfErr.message });
        }

        const urls = extractUrls(finalCode);
        let extraMsg = "";
        if (urls.length > 0) {
            extraMsg = "\n\n🔗 **Detected URLs:**\n" + urls.map(u => `- \`${u}\``).join("\n");
        }

        await interaction.editReply({
            content: `✅ **WeAreDevs Deobfuscated!**\nDownload the file below.${extraMsg}`,
            files: [new AttachmentBuilder(Buffer.from(finalCode, "utf-8"), { name: "deobfuscated.lua" })]
        });
    } catch (err) {
        await interaction.editReply({ content: `❌ **WeAreDevs Error:** \`${err.message.slice(0, 800)}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleMoonsec(interaction, code) {
    await interaction.editReply({ content: "⏳ **Moonsec Detected.** Running DLL + decompilers..." });

    const tempDir = path.join(__dirname, `ms_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);

    try {
        const result = await MoonsecBridge.run(tempIn);

        if (result && result.text && result.text.length > 50) {
            const urls = result.urls || [];
            let extraMsg = "";
            if (urls.length > 0) {
                extraMsg = "\n\n🔗 **Detected URLs:**\n" + urls.map(u => `- \`${u}\``).join("\n");
            }

            await interaction.editReply({
                content: `✅ **Moonsec Deobfuscated!** (via \`${result.decompiler}\`)\nDownload the file below.${extraMsg}`,
                files: [new AttachmentBuilder(Buffer.from(result.text, "utf-8"), { name: "deobfuscated.lua" })]
            });
        } else if (result && result.isBytecode) {
            await interaction.editReply({
                content: "⚠️ **Both decompilers failed.** Bytecode extracted. Upload it to `luadec.dev` manually.",
                files: [new AttachmentBuilder(result.buffer, { name: "extracted.luac" })]
            });
        } else if (result && result.error) {
            await interaction.editReply({ content: `❌ **Moonsec Error:** \`${result.error}\`` });
        } else {
            await interaction.editReply({ content: "❌ **Moonsec failed (unknown reason).**" });
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Moonsec Error:** \`${err.message.slice(0, 800)}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleStandardDeobfuscation(interaction, code, detectionName) {
    await interaction.editReply({ content: "🧠 **Smart Pipeline Activated:** Routing script through tools..." });
    const tempDir = path.join(__dirname, `pipeline_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const pipelineResult = await Pipeline.runChain(code, tempDir, detectionName);
        if (pipelineResult.code) {
            const finalBuffer = Buffer.from(pipelineResult.code, "utf-8");
            const finalName = pipelineResult.isClean ? "deobfuscated_clean.lua" : "extracted_partial.lua";

            const urls = extractUrls(pipelineResult.code);
            let extraMsg = "";
            if (urls.length > 0) {
                extraMsg = "\n\n🔗 **Detected URLs:**\n" + urls.map(u => `- \`${u}\``).join("\n");
            }

            const toolsStr = pipelineResult.tools.join(" ➔ ");
            const statusMsg = pipelineResult.isClean
                ? `✅ **Deobfuscation Complete!**\n🧠 Pipeline: \`${toolsStr}\`${extraMsg}`
                : `⚠️ **Partial Extraction.**\n🧠 Pipeline: \`${toolsStr}\`${extraMsg}`;

            await interaction.editReply({ content: statusMsg, files: [new AttachmentBuilder(finalBuffer, { name: finalName })] });
        } else {
            await interaction.editReply({ content: "❌ **Pipeline failed.** All tools exhausted." });
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Pipeline crashed:** \`${err.message}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

client.once("ready", () => {
    Logger.log("SUCCESS", `Bot online: ${client.user.tag}`);
    registerCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply().catch(() => {});

    try {
        if (interaction.commandName === "help") {
            return interaction.editReply({ content: "🤖 **God-Mode Deobfuscator V5**\n`/deobf`, `/deobf_url`, `/deobf_file`, `/detect`, `/layers`, `/vmdetect`" });
        }

        if (interaction.commandName === "vmdetect") {
            const { code, source } = await resolveCode(interaction);
            const vm = VMAnalyzer.analyze(code);
            const at = AntiTamperDetector.detect(code);
            return interaction.editReply({ content: `🖥️ **VM Analysis**\nSource: ${source}\nIs VM: **${vm.isVM ? "YES" : "No"}**\nFamily: **${vm.likelyFamily}**\nAnti-Tamper: **${at.riskLevel}**` });
        }

        if (interaction.commandName === "detect") {
            const { code, source } = await resolveCode(interaction);
            const detection = new Detector(code).detect();
            const layers = new Detector(code).analyzeLayers(code);
            return interaction.editReply({ content: `🔍 **Detection**\nSource: ${source}\nType: **${detection.name}**\nConfidence: **${detection.confidence}%**\nLayers: **${layers.layers.length}**` });
        }

        if (interaction.commandName === "layers") {
            const code = interaction.options.getString("code");
            const analysis = new Detector(code).analyzeLayers(code);
            return interaction.editReply({ content: `🧅 **Analyzed ${analysis.layers.length} layers.**`, files: [new AttachmentBuilder(Buffer.from(analysis.final, "utf-8"), { name: "unwrapped.lua" })] });
        }

        if (["deobf", "deobf_url", "deobf_file"].includes(interaction.commandName)) {
            const { code } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("Script is empty.");
            if (code.length > 500000) throw new Error("Script exceeds 500KB limit.");

            const quickDetect = new Detector(code).detect();

            if (quickDetect.name.includes("Moonsec") || code.includes("MoonSec")) {
                return await handleMoonsec(interaction, code);
            }

            if (quickDetect.name.includes("WeAreDevs") || code.includes("wearedevs.net/obfuscator")) {
                return await handleWeAreDevs(interaction, code);
            }

            const vmInfo = VMAnalyzer.analyze(code);
            if (vmInfo.isVM) {
                return await handleWeAreDevs(interaction, code);
            }

            await handleStandardDeobfuscation(interaction, code, quickDetect.name);
        }
    } catch (error) {
        await interaction.editReply({ content: `❌ **Error:** ${error.message.slice(0, 1500)}` }).catch(() => {});
    }
});

client.on("error", (error) => Logger.log("ERROR", "Client Error", { error: error.message }));
process.on("unhandledRejection", (error) => Logger.log("ERROR", "Unhandled Rejection", { error: error?.message || error }));

Logger.log("INFO", "Starting bot V5...");
client.login(TOKEN).catch((error) => {
    Logger.log("ERROR", "Login Failed", { error: error.message });
    process.exit(1);
});
