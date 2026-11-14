const puppeteer = require("puppeteer");

class Scraper {
    static async extract(url) {
        let browser;
        try {
            browser = await puppeteer.launch({
                headless: "new",
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-gpu",
                    "--single-process"
                ],
                executablePath: "/usr/bin/chromium-browser"
            });

            const page = await browser.newPage();
            
            let capturedScripts = [];
            let capturedUrls = [];

            page.on("response", async (response) => {
                try {
                    const contentType = response.headers()["content-type"] || "";
                    const reqUrl = response.url();
                    
                    if (reqUrl.includes(".lua") || contentType.includes("lua") || contentType.includes("text/plain") || contentType.includes("application/octet-stream")) {
                        const text = await response.text();
                        if (text && text.length > 50 && (text.includes("game:GetService") || text.includes("loadstring") || text.includes("return function") || text.includes("local "))) {
                            capturedScripts.push({ url: reqUrl, content: text });
                        }
                    }
                } catch (e) {}
            });

            page.on("request", (request) => {
                const reqUrl = request.url();
                if (reqUrl.includes(".lua") || reqUrl.includes("/script") || reqUrl.includes("/raw") || reqUrl.includes("/api/")) {
                    capturedUrls.push(reqUrl);
                }
            });

            await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
            
            await new Promise(r => setTimeout(r, 3000));

            const pageContent = await page.content();
            
            const luaRegex = /(?:loadstring|game:GetService|return\s+function|local\s+\w+\s*=)[\s\S]{50,}/g;
            const matches = pageContent.match(luaRegex);
            
            if (matches && matches.length > 0) {
                const decoded = matches.map(m => {
                    try { return decodeURIComponent(m); } catch (e) { return m; }
                });
                capturedScripts.push({ url: "page_content", content: decoded.join("\n\n") });
            }

            await browser.close();

            if (capturedScripts.length > 0) {
                capturedScripts.sort((a, b) => b.content.length - a.content.length);
                return { success: true, script: capturedScripts[0].content, source: capturedScripts[0].url, allUrls: capturedUrls };
            }

            return { success: false, error: "No Lua script found in page or network requests.", capturedUrls };
        } catch (err) {
            if (browser) await browser.close();
            return { success: false, error: err.message };
        }
    }
}

module.exports = { Scraper };
