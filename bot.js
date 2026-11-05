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
    } catch (error) {
        Logger.log("ERROR", "Failed to register commands", { error: error.message });
    }
}

async function resolveCode(interaction) {
    const codeOpt = interaction.options.getString("code");
    const urlOpt = interaction.options.getString("url");
    const fileOpt = interaction.options.getAttachment("file");
    if (codeOpt) return { code: codeOpt, source: "Direct input" };
    if (urlOpt) return { code: await fetchCodeFromUrl(urlOpt), source: `URL` };
    if (fileOpt) return { code: await readAttachment(fileOpt), source: `File` };
    throw new Error("Please provide code, URL, or file");
}

client.once("ready", () => {
    Logger.log("SUCCESS", `Bot online: ${client.user.tag}`);
    registerCommands();
});

client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === "help") {
        const embed = new EmbedBuilder().setColor(0x00aaff).setTitle("📖 God-Mode Deobfuscator V5").setDescription("Send me a URL or a File and I'll send you the clean code.");
        await interaction.reply({ embeds: [embed] });
        return;
    }

    if (interaction.commandName === "vmdetect") {
        await interaction.deferReply();
        try {
            const { code, source } = await resolveCode(interaction);
            const vm = VMAnalyzer.analyze(code);
            const at = AntiTamperDetector.detect(code);
            const embed = new EmbedBuilder().setColor(vm.isVM ? 0xff6600 : 0x00ff88).setTitle("🖥️ VM Structure Analysis").setDescription(`**Source:** ${source}`).addFields({ name: "Is VM", value: vm.isVM ? "YES" : "No", inline: true }, { name: "Risk", value: at.riskLevel, inline: true });
            await interaction.editReply({ embeds: [embed] });
        } catch (error) { await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` }); }
        return;
    }

    if (interaction.commandName === "detect") {
        await interaction.deferReply();
        try {
            const { code, source } = await resolveCode(interaction);
            const detection = new Detector(code).detect();
            const layerAnalysis = new Detector(code).analyzeLayers(code);
            const embed = new EmbedBuilder().setColor(0xffaa00).setTitle("🔍 Obfuscation Detection").setDescription(`**Source:** ${source}`).addFields({ name: "Type", value: detection.name, inline: true }, { name: "Confidence", value: `${detection.confidence}%`, inline: true }, { name: "Layers", value: `${layerAnalysis.layers.length}`, inline: true });
            await interaction.editReply({ embeds: [embed] });
        } catch (error) { await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` }); }
        return;
    }

    if (interaction.commandName === "layers") {
        await interaction.deferReply();
        try {
            const code = interaction.options.getString("code");
            const analysis = new Detector(code).analyzeLayers(code);
            const buffer = Buffer.from(analysis.final, "utf-8");
            await interaction.editReply({ content: `Total Layers: ${analysis.layers.length}`, files: [new AttachmentBuilder(buffer, { name: "unwrapped.lua" })] });
        } catch (error) { await interaction.editReply({ content: `❌ Error: ${error.message.slice(0, 1500)}` }); }
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

            if (quickDetect.name === "MoonVeil" || vmInfo.isVM || code.includes("wearedevs.net/obfuscator") || code.includes("zy28uHLFUuAPgKtOc0AcRNq")) {
                await interaction.editReply({ content: `⏳ **VM Detected**. Running inside Lua Sandbox to extract payload...` });
                const sandboxLogs = await LuaSandbox.run(code);
                
                if (sandboxLogs.includes("[LOADSTRING CAPTURED]")) {
                    const extractedCode = sandboxLogs.split("[LOADSTRING CAPTURED]")[1].split("-------------------")[0].trim();
                    const finalDeobf = new Deobfuscator(extractedCode, { beautify: true });
                    await finalDeobf.run();
                    
                    const buffer = Buffer.from(finalDeobf.code, "utf-8");
                    await interaction.editReply({ content: `✅ **Extracted Payload from VM successfully!**`, files: [new AttachmentBuilder(buffer, { name: "deobfuscated_clean.lua" })] });
                } else {
                    const buffer = Buffer.from(sandboxLogs, "utf-8");
                    await interaction.editReply({ content: `⚠️ **Sandbox ran, but no loadstring captured.** Check logs:`, files: [new AttachmentBuilder(buffer, { name: "sandbox_logs.txt" })] });
                }
                return;
            }

            await interaction.editReply({ content: `🧠 **الدماغ الذكي يعمل (V5):** جاري فحص السكربت وتجربة المحركات...` });
            
            const tempDir = path.join(__dirname, `temp_pipeline_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });

            try {
                const pipelineResult = await Pipeline.runChain(code, tempDir, quickDetect.name);
                
                if (pipelineResult.code) {
                    let finalBuffer = Buffer.from(pipelineResult.code, "utf-8");
                    let finalName = pipelineResult.isClean ? `deobfuscated_clean.lua` : `extracted_data.txt`;
                    let toolText = pipelineResult.tools.join(" ➔ ");
                    let statusMsg = pipelineResult.isClean 
                        ? `✅ **تم فك التشفير بنجاح!**\n🧠 المحركات: ${toolText}\n✨ الكود مرتب وجاهز.`
                        : `⚠️ **تم استخراج البيانات ولكن الكود ليس نظيفاً 100%**\n🧠 المحركات: ${toolText}`;

                    await interaction.editReply({ content: statusMsg });
                    await interaction.editReply({ files: [new AttachmentBuilder(finalBuffer, { name: finalName })] });
                    fs.rmSync(tempDir, { recursive: true, force: true });
                    return;
                } 
                
                await interaction.editReply({ content: `❌ **فشلت جميع الأدوات.**` });
                fs.rmSync(tempDir, { recursive: true, force: true });
                return;

            } catch (err) {
                await interaction.editReply({ content: `❌ خطأ داخلي: ${err.message}` });
                fs.rmSync(tempDir, { recursive: true, force: true });
                return;
            }

        } catch (error) {
            await interaction.editReply({ content: `❌ Deobfuscation Failed: ${error.message.slice(0, 1500)}` });
        }
        return;
    }
});

client.login(TOKEN);
