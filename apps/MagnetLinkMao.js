import puppeteer from "puppeteer";

/**
 * 磁力猫搜索插件
 * 通过磁力猫网站搜索磁力链接
 * @class MagnetLink
 * @extends plugin
 */
export class MagnetLink extends plugin {
    /**
     * 构造函数
     * @constructor
     */
    constructor() {
        super({
            name: "磁力猫搜索",
            dsc: "磁力猫搜索",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#?磁力猫(.*)$",
                    fnc: "processMagnetLink",
                },
            ],
        });
    }

    /**
     * 处理磁力猫搜索
     * 处理#磁力猫命令，搜索磁力链接
     * @param {Object} e - 事件对象
     * @returns {Promise<void>}
     */
    async processMagnetLink(e) {
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        let match = e.msg.match(
            /^#?磁力猫\s*(\S+)(\s+(\S+))?(\s+(\S+))?(\s+(\d+))?$/
        );
        if (!match) {
            return;
        }

        const userInput = encodeURIComponent(match[1]);
        const fileType = this.fileTypeMap[match[3]] ?? 0;
        const orderType = this.orderTypeMap[match[5]] ?? 0;
        const resultCount = parseInt(match[7]) || 10;

        const urls = [
            `https://dmirsrmb.8800543.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
            `https://rttthvpr.8800544.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
            `https://lrmeuifa.8800545.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
            `https://nmonmbjc.8800546.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
        ];

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: true,
        });
        let page;

        for (let i = 0; i < urls.length; i++) {
            try {
                page = await browser.newPage();
                await page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                );
                await page.goto(urls[i], {
                    waitUntil: "domcontentloaded",
                    timeout: 60000,
                });

                // 等待结果加载
                await page.waitForSelector(".ssbox", { timeout: 5000 });

                const searchResults = await page.$$(".ssbox");
                if (searchResults.length === 0) {
                    await this.reply("搜索失败，正在尝试下个链接");
                    await page.close();
                    continue;
                }

                const results = [];
                for (let i = 0; i < Math.min(resultCount, searchResults.length); i++) {
                    const result = searchResults[i];

                    // 提取标题
                    const title = await result.$eval(".title h3 a", (el) =>
                        el.textContent.trim()
                    );

                    // 提取磁力链接
                    const magnetLink = await result.$eval(
                        '.sbar a[href^="magnet:"]',
                        (el) => el.href
                    );

                    // 提取元数据
                    const metadata = await result.$$eval(".sbar span", (spans) => {
                        const data = {};
                        spans.forEach((span) => {
                            const text = span.textContent;
                            if (text.includes("添加时间")) {
                                data.addedTime = span.querySelector("b").textContent;
                            } else if (text.includes("大小")) {
                                data.size = span.querySelector(".yellow-pill").textContent;
                            } else if (text.includes("最近下载")) {
                                data.recentDownload = span.querySelector("b").textContent;
                            } else if (text.includes("热度")) {
                                data.heat = span.querySelector("b").textContent;
                            }
                        });
                        return data;
                    });

                    results.push({
                        user_id: e.user_id,
                        nickname: e.user_id,
                        message: `${title}\n\n${magnetLink}\n\n添加时间：${metadata.addedTime}\n大小：${metadata.size}\n最近下载：${metadata.recentDownload}\n热度：${metadata.heat}`,
                    });
                }

                if (results.length > 0) {
                    // 添加NapCat.Onebot自定义信息支持
                    if (e.bot?.version?.app_name === "NapCat.Onebot") {
                        try {
                            // 构建节点数组
                            const nodes = results.map((result) => {
                                return {
                                    type: "node",
                                    data: {
                                        nickname: result.nickname,
                                        user_id: result.user_id,
                                        content: [
                                            {
                                                type: "text",
                                                data: { text: result.message },
                                            },
                                        ],
                                    },
                                };
                            });

                            // 构建请求体 - 添加固定信息
                            const requestBody = {
                                group_id: e.group_id,
                                user_id: e.user_id,
                                message: nodes,
                                news: [{ text: "QQ/VX：1638276310" }],
                                prompt: "QQ/VX：1638276310",
                                summary: `QQ/VX：1638276310`,
                                source: "QQ/VX：1638276310",
                            };

                            // 根据消息类型发送
                            if (e.isGroup) {
                                await e.bot.sendApi("send_group_forward_msg", requestBody);
                            } else {
                                await e.bot.sendApi("send_private_forward_msg", requestBody);
                            }
                        } catch (error) {
                            logger.error("NapCat转发消息失败:", error);
                            await this.reply("消息发送失败，请稍后再试", true);
                        }
                    } else {
                        // 标准转发消息处理
                        try {
                            const forwardMsg = await Bot.makeForwardMsg(results);
                            await this.reply(forwardMsg);
                        } catch (error) {
                            logger.error("创建转发消息失败:", error);
                            await this.reply("消息发送失败，请稍后再试", true);
                        }
                    }

                    await browser.close();
                    return;
                } else {
                    await this.reply("未找到磁力链接");
                    await page.close();
                    continue;
                }
            } catch (error) {
                logger.log(`在URL ${urls[i]} 上出现错误：${error.toString()}`);
                if (page) await page.close();
                continue;
            }
        }
        await this.reply("所有链接均无搜索结果");
        await browser.close();
    }

    /**
     * 文件类型映射表
     * @type {Object}
     */
    fileTypeMap = {
        全部: 0,
        影视: 1,
        音乐: 2,
        图像: 3,
        文档: 4,
        压缩包: 5,
        安装包: 6,
        其他: 7,
    };

    /**
     * 排序类型映射表
     * @type {Object}
     */
    orderTypeMap = {
        相关度: 0,
        文件大小: 1,
        添加时间: 2,
        热度: 3,
        最近下载: 4,
    };
}