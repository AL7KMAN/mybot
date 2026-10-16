const { spawn } = require("child_process")

console.log("Starting Discord Bot...")
console.log("DISCORD_TOKEN:", process.env.DISCORD_TOKEN ? "Set" : "Missing")
console.log("CLIENT_ID:", process.env.CLIENT_ID ? "Set" : "Missing")

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN is missing!")
  process.exit(1)
}

if (!process.env.CLIENT_ID) {
  console.error("CLIENT_ID is missing!")
  process.exit(1)
}

console.log("Starting bot.js...")

const bot = spawn("node", ["bot.js"], {
  stdio: "inherit",
  env: process.env,
})

bot.on("close", (code) => {
  console.log(`Bot exited with code ${code}`)
  process.exit(code)
})

process.on("SIGINT", () => {
  bot.kill()
  process.exit(0)
})
