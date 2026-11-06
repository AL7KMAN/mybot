const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process"); // أضفنا spawn هنا لاستخدامه في الأداة الجديدة

const {
    Logger,
    Detector,
    VMAnalyzer,
    AntiTamperDetector,
    Deobfuscator,
    fetchCodeFromUrl,
    readAttachment
} = require("./core.js");

const { Pipeline } = require("./pipeline.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
    console.error("CRITICAL: Missing DISCORD_TOKEN or CLIENT_ID");
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName("deobf").setDescription("Deobfuscate Lua code from a string").addStringOption(o => o.setName("code").setDescription("Obfuscated Lua code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_url").setDescription("Deobfuscate Lua code from a URL").addStringOption(o => o.setName("url").setDescription("Raw URL to code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate Lua code from a file").addAttachmentOption(o => o.setName("file").setDescription("Lua file").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("layers").setDescription("Analyze nested layers").addStringOption(o => o.setName("code").setDescription("Code").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("vmdetect").setDescription("Analyze VM structure").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("help").setDescription("Show commands").toJSON(),
].map(c => c);

async function registerCommands() {
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    try {
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        Logger.log("SUCCESS", "Slash commands registered globally");
    } catch (error) {
        Logger.log("ERROR", "Command registration failed", { error: error.message });
    }
}

async function resolveCode(interaction) {
    const codeOpt = interaction.options.getString("code");
    const urlOpt = interaction.options.getString("url");
    const fileOpt = interaction.options.getAttachment("file");
    if (codeOpt) return { code: codeOpt, source: "Direct Input" };
    if (urlOpt) return { code: await fetchCodeFromUrl(urlOpt), source: "URL" };
    if (fileOpt) return { code: await readAttachment(fileOpt), source: "File" };
    throw new Error("Provide code, URL, or file");
}

// ============================================================
// الدالة الجديدة والمعدلة بالكامل لاستخدام أداة Node.js
// ============================================================
async function handleVMExecution(interaction, code) {
    await interaction.editReply({ content: "⏳ **WeAreDevs Detected.** Running Node.js deobfuscator..." });

    const tempDir = path.join(__dirname, `vm_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    const tempOut = path.join(tempDir, "output.lua");
    fs.writeFileSync(tempIn, code);

    try {
        const result = await new Promise((resolve, reject) => {
            // استدعاء الأداة الجديدة مباشرة عبر Node.js
            const proc = spawn("node", [
                path.join(__dirname, "prometheus-deobf", "bin", "pdeobf.js"),
                tempIn,
                "-o", tempOut
            ], { timeout: 300000 }); // 5 دقائق مهلة

            let stderr = "";
            proc.stderr.on("data", (d) => stderr += d.toString());

            proc.on("close", (exitCode) => {
                if (exitCode !== 0) {
                    return reject(new Error(`Deobfuscator exited (${exitCode}): ${stderr.slice(-500)}`));
                }
                if (!fs.existsSync(tempOut)) {
                    return reject(new Error("Deobfuscator produced no output file."));
                }
                resolve(fs.readFileSync(tempOut, "utf-8"));
            });
        });

        if (!result || result.length < 50) {
            return interaction.editReply({ content: `❌ Deobfuscator returned insufficient output (${result?.length || 0} chars).` });
        }

        const buffer = Buffer.from(result, "utf-8");
        await interaction.editReply({
            content: `✅ **Deobfuscated successfully!** (${result.split("\n").length} lines)`,
            files: [new AttachmentBuilder(buffer, { name: "deobfuscated.lua" })]
        });

    } catch (err) {
        Logger.log("ERROR", "Node.js deobfuscator failed", { error: err.message });
        await interaction.editReply({ content: `❌ **Error:** \`${err.message.slice(0, 500)}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleStandardDeobfuscation(interaction, code, detectionName) {
    await interaction.editReply({ content: "🧠 **Smart Pipeline running...**" });

    const tempDir = path.join(__dirname, `pipe_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const pipelineResult = await Pipeline.runChain(code, tempDir, detectionName);

        if (pipelineResult.code) {
            const buffer = Buffer.from(pipelineResult.code, "utf-8");
            const finalName = pipelineResult.isClean ? "deobfuscated_clean.lua" : "extracted_partial.lua";
            const toolsStr = pipelineResult.tools.join(" ➔ ");
            const statusMsg = pipelineResult.isClean
                ? `✅ **Complete!** Engine: \`${toolsStr}\``
                : `⚠️ **Partial.** Engine: \`${toolsStr}\``;
            await interaction.editReply({ content: statusMsg, files: [new AttachmentBuilder(buffer, { name: finalName })] });
        } else {
            await interaction.editReply({ content: "❌ **Pipeline exhausted. No result.**" });
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Pipeline crashed:** \`${err.message.slice(0, 500)}\`` });
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
            return interaction.editReply({
                content: "🤖 **LM7H Deobfuscator V5**\n`/deobf` `/deobf_url` `/deobf_file` `/detect` `/layers` `/vmdetect`"
            });
        }

        if (interaction.commandName === "vmdetect") {
            const { code, source } = await resolveCode(interaction);
            const vm = VMAnalyzer.analyze(code);
            const at = AntiTamperDetector.detect(code);
            return interaction.editReply({
                content: `🖥️ **VM Analysis**\nSource: ${source}\nIs VM: **${vm.isVM ? "YES" : "No"}**\nFamily: **${vm.likelyFamily}**\nAnti-Tamper: **${at.riskLevel}**`
            });
        }

        if (interaction.commandName === "detect") {
            const { code, source } = await resolveCode(interaction);
            const detection = new Detector(code).detect();
            const layers = new Detector(code).analyzeLayers(code);
            return interaction.editReply({
                content: `🔍 **Detection**\nSource: ${source}\nType: **${detection.name}**\nConfidence: **${detection.confidence}%**\nLayers: **${layers.layers.length}**`
            });
        }

        if (interaction.commandName === "layers") {
            const code = interaction.options.getString("code");
            const analysis = new Detector(code).analyzeLayers(code);
            return interaction.editReply({
                content: `🧅 **${analysis.layers.length} layers detected**`,
                files: [new AttachmentBuilder(Buffer.from(analysis.final, "utf-8"), { name: "unwrapped.lua" })]
            });
        }

        if (["deobf", "deobf_url", "deobf_file"].includes(interaction.commandName)) {
            const { code } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("Empty script");
            if (code.length > 500000) throw new Error("Script too large (max 500KB)");

            const quickDetect = new Detector(code).detect();
            const vmInfo = VMAnalyzer.analyze(code);

            const isVM = quickDetect.name === "MoonVeil"
                || quickDetect.name === "WeAreDevs"
                || vmInfo.isVM
                || code.includes("wearedevs.net/obfuscator")
                || code.includes("zy28uHLFUuAPgKtOc0AcRNq");

            if (isVM) {
                await handleVMExecution(interaction, code);
            } else {
                await handleStandardDeobfuscation(interaction, code, quickDetect.name);
            }
        }
    } catch (error) {
        Logger.log("ERROR", "Command error", { error: error.message });
        await interaction.editReply({ content: `❌ **Error:** ${error.message.slice(0, 1500)}` }).catch(() => {});
    }
});

client.on("error", (error) => Logger.log("ERROR", "Client error", { error: error.message }));
process.on("unhandledRejection", (error) => Logger.log("ERROR", "Unhandled rejection", { error: error?.message || error }));

Logger.log("INFO", "Starting LM7H V5...");
client.login(TOKEN).catch((error) => {
    Logger.log("ERROR", "Login failed", { error: error.message });
    process.exit(1);
});
