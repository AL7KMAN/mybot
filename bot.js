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

async function handleVMExecution(interaction, code, detectionName) {
    await interaction.editReply({ content: `⏳ **${detectionName} Detected.** Running Native Engine...` });
    
    const tempDir = path.join(__dirname, `vm_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);

    try {
        let result = "";
        if (detectionName.includes("Moonsec")) {
            result = await MoonsecBridge.run(tempIn);
        } else {
            result = await PythonBridge.run("wearedevs", tempIn);
        }
        
        if (result && result.length > 50 && !result.includes("local Constants") && !result.includes("UNPACK CALLED")) {
            const finalDeobf = new Deobfuscator(result, { beautify: true });
            await finalDeobf.run();
            
            const buffer = Buffer.from(finalDeobf.code, "utf-8");
            await interaction.editReply({
                content: `✅ **Extracted clean payload!**`,
                files: [new AttachmentBuilder(buffer, { name: "deobfuscated.lua" })]
            }).catch(() => {});
        } else {
            const report = `=== DIAGNOSTICS ===\n\nOutput:\n${result ? result.slice(0, 5000) : 'None'}`;
            await interaction.editReply({
                content: "❌ **Failed to extract clean code.** Diagnostics attached:",
                files: [new AttachmentBuilder(Buffer.from(report, "utf-8"), { name: "diagnostics.txt" })]
            }).catch(() => {});
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` }).catch(() => {});
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
            const toolsStr = pipelineResult.tools.join(" ➔ ");
            const statusMsg = pipelineResult.isClean
                ? `✅ **Deobfuscation Complete!**\n🧠 Pipeline: \`${toolsStr}\``
                : `⚠️ **Partial Extraction.**\n🧠 Pipeline: \`${toolsStr}\``;
            await interaction.editReply({ content: statusMsg, files: [new AttachmentBuilder(finalBuffer, { name: finalName })] }).catch(() => {});
        } else {
            await interaction.editReply({ content: "❌ **Pipeline failed.** All tools exhausted." }).catch(() => {});
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Pipeline crashed:** \`${err.message}\`` }).catch(() => {});
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
            const vmInfo = VMAnalyzer.analyze(code);

            const isTargetVM = quickDetect.name.includes("WeAreDevs") || 
                               quickDetect.name.includes("Moonsec") || 
                               vmInfo.isVM || 
                               code.includes("wearedevs.net/obfuscator") || 
                               code.includes("MoonSec");

            if (isTargetVM) {
                await handleVMExecution(interaction, code, quickDetect.name);
            } else {
                await handleStandardDeobfuscation(interaction, code, quickDetect.name);
            }
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
