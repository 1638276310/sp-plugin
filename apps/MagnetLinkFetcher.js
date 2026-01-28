import puppeteer from "puppeteer";
import fs from "fs";
import YAML from "yaml";
import { magnetURL } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * 磁力链接查询插件
 * 根据磁力链接查询文件详细信息并截图
 * @class MagnetLinkFetcher
 * @extends plugin
 */
export class MagnetLinkFetcher extends plugin {
    /**
     * 构造函数
     * @constructor
     */
    constructor() {
        super({
            name: "磁力查询",
            dsc: "根据磁力链接查询文件信息",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#验车(magnet:.+)$",
                    fnc: "processMagnetLink",
                },
            ],
        });
    }

    /**
     * 获取撤回配置
     * 从YAML文件加载消息撤回配置
     * @returns {Object} 撤回配置对象
     */
    getRecallConfig() {
        const path = "./plugins/sp-plugin/config/recall.yaml";
        const fileContents = fs.readFileSync(path, "utf8");
        return YAML.parse(fileContents);
    }

    /**
     * 启动浏览器实例
     * 创建并配置Puppeteer浏览器实例
     * @returns {Promise<puppeteer.Browser>} Puppeteer浏览器实例
     */
    async _launchBrowser() {
        return await puppeteer.launch({
            headless: "new",
            args: [
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--disable-setuid-sandbox",
                "--no-sandbox",
                "--window-size=1920,1080",
            ],
            timeout: 60000,
        });
    }

    /**
     * 使用Puppeteer获取数据
     * 通过Puppeteer访问网站并提取数据
     * @param {string} url - 要访问的URL
     * @param {Object} e - 事件对象
     * @returns {Promise<Object>} 解析后的数据对象
     */
    async fetchWithPuppeteer(url, e) {
        await this.reply("正在验车，请稍等...", false, { at: true, recallMsg: 60 });
        let browser;
        try {
            browser = await this._launchBrowser();
            const page = await browser.newPage();

            await page.setExtraHTTPHeaders({
                Accept: "application/json, text/plain, */*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
                Referer: "https://whatslink.info/",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            });

            let responseData;
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });

            try {
                const jsonContent = await page.$eval(
                    'div[hidden="true"]',
                    (div) => div.textContent
                );
                responseData = JSON.parse(jsonContent);
            } catch (parseError) {
                responseData = await page.evaluate(() => {
                    try {
                        return JSON.parse(document.body.innerText);
                    } catch (e) {
                        return { error: "数据解析失败" };
                    }
                });
            }

            if (!responseData || typeof responseData !== "object") {
                throw new Error("无效的响应数据格式");
            }

            return responseData;
        } catch (error) {
            logger.error("Puppeteer操作失败:", error);
            throw new Error(`网站访问失败: ${error.message}`);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * 使用Puppeteer下载图片
     * 通过Puppeteer下载指定URL的图片
     * @param {string} imageUrl - 图片URL
     * @returns {Promise<Buffer>} 图片Buffer数据
     */
    async fetchImageWithPuppeteer(imageUrl) {
        let browser;
        try {
            browser = await this._launchBrowser();
            const page = await browser.newPage();

            await page.setExtraHTTPHeaders({
                Accept: "application/json, text/plain, */*",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
                Referer: "https://whatslink.info/",
                "User-Agent":
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
            });

            const response = await page.goto(imageUrl, {
                waitUntil: "domcontentloaded",
                timeout: 30000,
            });

            if (!response.ok()) {
                throw new Error(`图片下载失败: ${response.status()}`);
            }

            return await response.buffer();
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    /**
     * 使用Python处理图片
     * 调用外部Python脚本处理图片
     * @param {Buffer} imageBuffer - 原始图片Buffer
     * @param {string} imageName - 图片名称
     * @returns {Promise<Buffer>} 处理后的图片Buffer
     */
    async modifyImageWithPython(imageBuffer, imageName) {
        const tempImagePath = `./plugins/sp-plugin/temp/temp_${Date.now()}_${imageName}.jpg`;
        const cleanUp = () => {
            if (fs.existsSync(tempImagePath)) {
                fs.unlinkSync(tempImagePath);
            }
        };

        try {
            fs.writeFileSync(tempImagePath, imageBuffer);
            const modifiedImagePath = await modifyImageSharp(tempImagePath);
            if (!fs.existsSync(modifiedImagePath)) {
                throw new Error("Sharp处理图片失败");
            }
            const modifiedImageBuffer = fs.readFileSync(modifiedImagePath);
            cleanUp();
            fs.unlinkSync(modifiedImagePath);
            return modifiedImageBuffer;
        } catch (error) {
            cleanUp();
            throw error;
        }
    }

    /**
     * 处理磁力链接
     * 主函数，处理#验车命令，查询磁力链接详情
     * @param {Object} e - 事件对象
     * @returns {Promise<void>}
     */
    async processMagnetLink(e) {
        let retryCount = 3;
        const retryDelay = 2000;

        while (retryCount-- > 0) {
            try {
                const matchedMagnet = e.msg.match(/^#验车(magnet:.+)$/)[1];
                const url = magnetURL(matchedMagnet);

                const response = await this.fetchWithPuppeteer(url, e);
                if (!response || response.error) {
                    throw new Error(response?.error || "无效的响应数据");
                }

                const msgData = [
                    `磁力链接：${matchedMagnet}\n\n`,
                    `文件名字：${response.name}\n`,
                    `文件类型：${response.file_type}\n`,
                    `文件数量：${response.count}\n`,
                    `文件大小：${(response.size / 1e9).toFixed(1)}GB\n`,
                ];

                // 构建消息列表
                const messages = [
                    {
                        message: msgData.join(""),
                        nickname: e.user_id.toString(),
                        user_id: e.user_id,
                    },
                ];

                // 处理截图
                if (response.screenshots?.length > 0) {
                    const processingPromises = response.screenshots
                        .slice(0, 9)
                        .map(async (s, index) => {
                            try {
                                const imageBuffer = await this.fetchImageWithPuppeteer(
                                    s.screenshot
                                );
                                const modifiedBuffer = await this.modifyImageWithPython(
                                    imageBuffer,
                                    `screenshot_${index}`
                                );
                                return `base64://${modifiedBuffer.toString("base64")}`;
                            } catch (error) {
                                logger.error(`截图处理失败: ${error}`);
                                return null;
                            }
                        });

                    const screenshotData = (await Promise.all(processingPromises)).filter(
                        Boolean
                    );

                    // 添加截图到消息列表
                    if (screenshotData.length > 0) {
                        screenshotData.forEach((screenshot, index) => {
                            messages.push({
                                message: [`截图 ${index + 1}`, "\n", segment.image(screenshot)],
                                nickname: e.user_id.toString(),
                                user_id: e.user_id,
                            });
                        });
                    }
                }

                // 处理NapCat.Onebot的特殊转发格式
                if (e.bot?.version?.app_name === "NapCat.Onebot") {
                    const nodes = messages.map((msg) => {
                        const content = [];
                        let msgArray = [];

                        // 处理不同类型的消息内容
                        if (Array.isArray(msg.message)) {
                            msgArray = msg.message;
                        } else if (typeof msg.message === "string") {
                            msgArray = [msg.message];
                        } else {
                            msgArray = [msg.message];
                        }

                        // 构建消息节点
                        for (const item of msgArray) {
                            if (typeof item === "string") {
                                content.push({
                                    type: "text",
                                    data: { text: item },
                                });
                            } else if (item?.type === "image") {
                                // 安全获取图片URL或base64
                                const fileUrl =
                                    item.data?.file || item.data?.url || item.file || "";
                                if (fileUrl) {
                                    content.push({
                                        type: "image",
                                        data: { file: fileUrl },
                                    });
                                } else {
                                    logger.error("图片URL解析失败:", item);
                                    content.push({
                                        type: "text",
                                        data: { text: "[图片解析失败]" },
                                    });
                                }
                            } else {
                                content.push({
                                    type: "text",
                                    data: { text: "不支持的消息类型" },
                                });
                            }
                        }

                        return {
                            type: "node",
                            data: {
                                nickname: msg.nickname,
                                user_id: msg.user_id,
                                content: content,
                            },
                        };
                    });

                    // 构建请求体
                    const requestBody = {
                        messages: nodes,
                    };

                    // 根据消息类型添加参数
                    if (e.isGroup) {
                        requestBody.group_id = e.group_id;
                    } else {
                        requestBody.user_id = e.user_id;
                    }

                    try {
                        // 根据消息类型发送
                        if (e.isGroup) {
                            await e.bot.sendApi("send_group_forward_msg", requestBody);
                        } else {
                            await e.bot.sendApi("send_private_forward_msg", requestBody);
                        }
                    } catch (error) {
                        logger.error("NapCat转发消息失败:", error);
                        await e.reply("消息发送失败，请稍后再试", true);
                    }
                } else {
                    // 标准转发消息处理
                    try {
                        const forwardMsg = e.isGroup
                            ? await e.group.makeForwardMsg(messages)
                            : await e.friend.makeForwardMsg(messages);

                        const recallConfig = this.getRecallConfig();
                        const sentMessage = await e.reply(forwardMsg);

                        if (recallConfig.recall) {
                            setTimeout(() => {
                                e.isGroup
                                    ? e.group.recallMsg(sentMessage.message_id)
                                    : e.friend.recallMsg(sentMessage.message_id);
                            }, recallConfig.time).unref();
                        }
                    } catch (error) {
                        logger.error("创建转发消息失败:", error);
                        await e.reply("消息发送失败，请稍后再试", true);
                    }
                }

                return;
            } catch (error) {
                logger.error(`第${3 - retryCount}次尝试失败:`, error);
                if (retryCount > 0) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelay));
                } else {
                    await e.reply(`查询失败: ${error.message}`);
                }
            }
        }
    }
}