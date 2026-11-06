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
    console.error("CRITICAL: Missing DISCORD_TOKEN or CLIENT_ID environment variables.");
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
        Logger.log("SUCCESS", "Slash commands registered globally.");
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

async function handleVMExecution(interaction, code) {
    await interaction.editReply({ content: "⏳ **VM Detected.** Bypassing static analysis, deploying native execution engines..." });
    
    const tempIn = path.join(__dirname, `vm_temp_${Date.now()}.lua`);
    fs.writeFileSync(tempIn, code);
    const wrapperPath = path.join(__dirname, "wrapper.lua");

    try {
        if (fs.existsSync(wrapperPath)) {
            try {
                const r = await PythonBridge.runLua51(tempIn, wrapperPath);
                if (r && r.captured && r.captured.payload && r.captured.payload.length > 30) {
                    const finalDeobf = new Deobfuscator(r.captured.payload, { beautify: true });
                    await finalDeobf.run();
                    const buffer = Buffer.from(finalDeobf.code, "utf-8");
                    await interaction.editReply({
                        content: "✅ **Extracted clean payload via Native Lua 5.1 Engine!**",
                        files: [new AttachmentBuilder(buffer, { name: "deobfuscated_clean.lua" })]
                    });
                    return;
                }
            } catch (luaErr) {
                Logger.log("WARN", "Lua 5.1 bypass failed, falling back to Wasmoon", { error: luaErr.message });
            }
        }

        const sandboxResult = await LuaSandbox.run(code);
        if (sandboxResult.captures && sandboxResult.captures.length > 0) {
            const bestCapture = sandboxResult.captures.reduce((a, b) => a.length > b.length ? a : b, "");
            const finalDeobf = new Deobfuscator(bestCapture, { beautify: true });
            await finalDeobf.run();
            const buffer = Buffer.from(finalDeobf.code, "utf-8");
            await interaction.editReply({
                content: `✅ **Extracted payload via Wasmoon Sandbox!**\n🧠 Found ${sandboxResult.captures.length} chunks.`,
                files: [new AttachmentBuilder(buffer, { name: "deobfuscated_clean.lua" })]
            });
            return;
        }

        const report = `=== SANDBOX DIAGNOSTICS ===\n\n[ERROR]\n${sandboxResult.error || 'None'}\n\n[LOGS]\n${sandboxResult.logs || 'Empty'}`;
        await interaction.editReply({
            content: "❌ **VM engines failed to capture payload.** The script is likely heavily anti-tampered. Diagnostics attached:",
            files: [new AttachmentBuilder(Buffer.from(report, "utf-8"), { name: "vm_diagnostics.txt" })]
        });
    } finally {
        try { fs.unlinkSync(tempIn); } catch (e) {}
    }
}

async function handleStandardDeobfuscation(interaction, code, detectionName) {
    await interaction.editReply({ content: "🧠 **Smart Pipeline Activated:** Routing script through deobfuscation tools..." });

    const tempDir = path.join(__dirname, `pipeline_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    try {
        const pipelineResult = await Pipeline.runChain(code, tempDir, detectionName);
        
        if (pipelineResult.code) {
            const finalBuffer = Buffer.from(pipelineResult.code, "utf-8");
            const finalName = pipelineResult.isClean ? "deobfuscated_clean.lua" : "extracted_partial.lua";
            const toolsStr = pipelineResult.tools.join(" ➔ ");
            
            const statusMsg = pipelineResult.isClean
                ? `✅ **Deobfuscation Complete!**\n🧠 Pipeline: \`${toolsStr}\`\n✨ Code is clean and beautified.`
                : `⚠️ **Partial Extraction Complete.**\n🧠 Pipeline: \`${toolsStr}\`\n*(Script may require runtime execution)*`;

            await interaction.editReply({ content: statusMsg, files: [new AttachmentBuilder(finalBuffer, { name: finalName })] });
        } else {
            await interaction.editReply({ content: "❌ **Pipeline failed.** All tools exhausted without result." });
        }
    } catch (err) {
        Logger.log("ERROR", "Pipeline Error", { error: err.message });
        await interaction.editReply({ content: `❌ **Pipeline crashed:** \`${err.message}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

client.once("ready", () => {
    Logger.log("SUCCESS", `Bot online: ${client.user.tag}`);
    Logger.log("INFO", `Serving ${client.guilds.cache.size} guilds.`);
    registerCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    await interaction.deferReply().catch(() => {});

    try {
        if (interaction.commandName === "help") {
            const embed = new EmbedBuilder()
                .setColor(0x2b2d31)
                .setTitle("🤖 God-Mode Deobfuscator V5")
                .setDescription("Advanced Lua deobfuscation with multi-engine routing.")
                .addFields(
                    { name: "⚙️ Core", value: "`/deobf`, `/deobf_url`, `/deobf_file`" },
                    { name: "🔍 Analysis", value: "`/detect`, `/layers`, `/vmdetect`" }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        if (interaction.commandName === "vmdetect") {
            const { code, source } = await resolveCode(interaction);
            const vm = VMAnalyzer.analyze(code);
            const at = AntiTamperDetector.detect(code);
            const embed = new EmbedBuilder()
                .setColor(vm.isVM ? 0xff6600 : 0x00ff88)
                .setTitle("🖥️ VM Analysis")
                .addFields(
                    { name: "Source", value: source, inline: true },
                    { name: "Is VM", value: vm.isVM ? `YES (${vm.score}/20)` : "No", inline: true },
                    { name: "Family", value: vm.likelyFamily, inline: true },
                    { name: "Anti-Tamper", value: at.riskLevel, inline: true }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        if (interaction.commandName === "detect") {
            const { code, source } = await resolveCode(interaction);
            const detection = new Detector(code).detect();
            const layers = new Detector(code).analyzeLayers(code);
            const embed = new EmbedBuilder()
                .setColor(detection.name === "Clean" ? 0x00ff88 : 0xffaa00)
                .setTitle("🔍 Obfuscation Detection")
                .addFields(
                    { name: "Source", value: source, inline: true },
                    { name: "Type", value: detection.name, inline: true },
                    { name: "Confidence", value: `${detection.confidence}%`, inline: true },
                    { name: "Layers", value: `${layers.layers.length}`, inline: true }
                );
            return interaction.editReply({ embeds: [embed] });
        }

        if (interaction.commandName === "layers") {
            const code = interaction.options.getString("code");
            const analysis = new Detector(code).analyzeLayers(code);
            return interaction.editReply({
                content: `🧅 **Analyzed ${analysis.layers.length} layers.**`,
                files: [new AttachmentBuilder(Buffer.from(analysis.final, "utf-8"), { name: "unwrapped.lua" })]
            });
        }

        if (["deobf", "deobf_url", "deobf_file"].includes(interaction.commandName)) {
            const { code } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("Provided script is empty.");
            if (code.length > 500000) throw new Error("Script exceeds 500KB limit.");

            const quickDetect = new Detector(code).detect();
            const vmInfo = VMAnalyzer.analyze(code);

            const isTargetVM = quickDetect.name === "MoonVeil" || 
                               quickDetect.name === "WeAreDevs" || 
                               vmInfo.isVM || 
                               code.includes("wearedevs.net/obfuscator") || 
                               code.includes("zy28uHLFUuAPgKtOc0AcRNq");

            if (isTargetVM) {
                await handleVMExecution(interaction, code);
            } else {
                await handleStandardDeobfuscation(interaction, code, quickDetect.name);
            }
        }
    } catch (error) {
        Logger.log("ERROR", `Command Error: ${interaction.commandName}`, { error: error.message });
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
