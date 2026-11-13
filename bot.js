const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } = require("discord.js");
const { REST } = require("@discordjs/rest");
const { Routes } = require("discord-api-types/v9");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const { Logger, Detector, VMAnalyzer, AntiTamperDetector, Deobfuscator, fetchCodeFromUrl, readAttachment } = require('./core.js');
const { PythonBridge } = require('./tools.js');
const { MoonsecBridge } = require('./moonsec.js');
const { IronBrewBridge } = require('./ironbrew.js');
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
    new SlashCommandBuilder().setName("deobf_file").setDescription("Deobfuscate Lua code from a file").addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(true)).toJSON(),
    new SlashCommandBuilder().setName("detect").setDescription("Detect obfuscator type").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).addStringOption(o => o.setName("url").setDescription("URL").setRequired(false)).addAttachmentOption(o => o.setName("file").setDescription("File").setRequired(false)).toJSON(),
    new SlashCommandBuilder().setName("vmdetect").setDescription("Analyze VM").addStringOption(o => o.setName("code").setDescription("Code").setRequired(false)).toJSON(),
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

async function handleIronBrew(interaction, code) {
    await interaction.editReply({ content: "⏳ **IronBrew2 Detected.** Running C# deobfuscator..." });
    const tempDir = path.join(__dirname, `ib_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);
    
    try {
        const result = await IronBrewBridge.run(tempIn);
        
        if (result && result.text && result.text.length > 50) {
            const urls = result.text.match(/https?:\/\/[^\s"'`]+/g) || [];
            const attachments = [new AttachmentBuilder(Buffer.from(result.text, "utf-8"), { name: "deobfuscated.lua" })];
            
            for (const url of [...new Set(urls)].slice(0, 5)) {
                try {
                    const resp = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, timeout: 10000 });
                    if (resp.ok) {
                        const txt = await resp.text();
                        if (txt.length > 20 && !txt.startsWith("<!DOCTYPE")) {
                            const fname = url.split("/").pop().split("?")[0].slice(0, 50) || "nested.lua";
                            attachments.push(new AttachmentBuilder(Buffer.from(txt, "utf-8"), { name: fname }));
                        }
                    }
                } catch (e) {}
            }
            
            await interaction.editReply({ content: `✅ **IronBrew2 Deobfuscated!**\n📦 ${attachments.length} file(s).`, files: attachments.slice(0, 10) });
            return;
        }
        
        const reportText = `=== LM7H IRONBREW DIAGNOSTIC ===\n\nError: ${result?.error || "Unknown"}\n\nDetails:\n${result?.details || "No details"}\n\n===============================`;
        const snippet = reportText.length > 1500 ? reportText.slice(0, 1500) + "\n..." : reportText;
        
        await interaction.editReply({
            content: `❌ **IronBrew Failed.**\n\`\`\`text\n${snippet}\n\`\`\``,
            files: [new AttachmentBuilder(Buffer.from(reportText, "utf-8"), { name: "diagnostic.txt" })]
        });
    } catch (err) {
        await interaction.editReply({ content: `❌ **Error:** ${err.message.slice(0, 800)}` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleMoonsec(interaction, code) {
    await interaction.editReply({ content: "⏳ **Moonsec Detected.** Running..." });
    const tempDir = path.join(__dirname, `ms_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);
    try {
        const result = await MoonsecBridge.run(tempIn);
        if (result && result.text && result.text.length > 50) {
            await interaction.editReply({ content: `✅ **Moonsec Deobfuscated!**`, files: [new AttachmentBuilder(Buffer.from(result.text, "utf-8"), { name: "deobfuscated.lua" })] });
        } else if (result && result.isBytecode) {
            await interaction.editReply({ content: "⚠️ **Bytecode extracted.** Upload to `luadec.dev`.", files: [new AttachmentBuilder(result.buffer, { name: "extracted.luac" })] });
        } else {
            await interaction.editReply({ content: `❌ **Error:** \`${result?.error}\`` });
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Error:** \`${err.message.slice(0, 800)}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleWeAreDevs(interaction, code) {
    await interaction.editReply({ content: "⏳ **WeAreDevs Detected.** Running..." });
    const tempDir = path.join(__dirname, `wd_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const tempIn = path.join(tempDir, "input.lua");
    fs.writeFileSync(tempIn, code);
    try {
        const rawResult = await PythonBridge.run("wearedevs", tempIn);
        if (typeof rawResult !== "string" || rawResult.length < 50) {
            return interaction.editReply({ content: `❌ **WeAreDevs failed.** \`${String(rawResult).slice(0, 400)}\`` });
        }
        let finalCode = rawResult;
        try {
            const finalDeobf = new Deobfuscator(rawResult, { beautify: true });
            await finalDeobf.run();
            if (finalDeobf.code && finalDeobf.code.length > 50) finalCode = finalDeobf.code;
        } catch (e) {}
        await interaction.editReply({ content: `✅ **WeAreDevs Deobfuscated!**`, files: [new AttachmentBuilder(Buffer.from(finalCode, "utf-8"), { name: "deobfuscated.lua" })] });
    } catch (err) {
        await interaction.editReply({ content: `❌ **Error:** \`${err.message.slice(0, 800)}\`` });
    } finally {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    }
}

async function handleStandardDeobfuscation(interaction, code, detectionName) {
    await interaction.editReply({ content: "🧠 **Pipeline Activated...**" });
    const tempDir = path.join(__dirname, `pipeline_${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    try {
        const pipelineResult = await Pipeline.runChain(code, tempDir, detectionName);
        if (pipelineResult.code) {
            await interaction.editReply({ content: `✅ **Complete!**`, files: [new AttachmentBuilder(Buffer.from(pipelineResult.code, "utf-8"), { name: "deobfuscated.lua" })] });
        } else {
            await interaction.editReply({ content: "❌ **Pipeline failed.**" });
        }
    } catch (err) {
        await interaction.editReply({ content: `❌ **Error:** \`${err.message}\`` });
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
            return interaction.editReply({ content: "🤖 **Deobfuscator**\n`/deobf`, `/deobf_url`, `/deobf_file`, `/detect`" });
        }

        if (["deobf", "deobf_url", "deobf_file"].includes(interaction.commandName)) {
            const { code } = await resolveCode(interaction);
            if (!code || code.trim().length === 0) throw new Error("Script is empty.");

            const quickDetect = new Detector(code).detect();
            const vmInfo = VMAnalyzer.analyze(code);
            const type = quickDetect.name;

            if (type.includes("IronBrew") || type.includes("AztupBrew") || vmInfo.likelyFamily === "IronBrew" || code.includes("IronBrew")) {
                return await handleIronBrew(interaction, code);
            }

            if (type.includes("Moonsec") || code.includes("MoonSec")) {
                return await handleMoonsec(interaction, code);
            }

            if (type.includes("WeAreDevs") || code.includes("wearedevs.net/obfuscator")) {
                return await handleWeAreDevs(interaction, code);
            }

            await handleStandardDeobfuscation(interaction, code, type);
        }
    } catch (error) {
        await interaction.editReply({ content: `❌ **Error:** ${error.message.slice(0, 1500)}` }).catch(() => {});
    }
});

client.login(TOKEN).catch((error) => {
    Logger.log("ERROR", "Login Failed", { error: error.message });
    process.exit(1);
});
