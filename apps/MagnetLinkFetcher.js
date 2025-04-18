import plugin from '../../../lib/plugins/plugin.js';
import puppeteer from 'puppeteer';
import fs from 'fs';
import YAML from 'yaml';
import { magnetURL } from '../config/api.js';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

export class MagnetLinkFetcher extends plugin {
    constructor() {
        super({
            name: '磁力查询',
            dsc: '根据磁力链接查询文件信息',
            event: 'message',
            priority: '50',
            rule: [
                {
                    reg: '^#验车(magnet:.+)$',
                    fnc: 'processMagnetLink'
                }
            ]
        });
    }

    getRecallConfig() {
        const path = './plugins/kkp-plugin/config/recall.yaml';
        const fileContents = fs.readFileSync(path, 'utf8');
        return YAML.parse(fileContents);
    }

    async _launchBrowser() {
        return await puppeteer.launch({
            headless: 'new',
            args: [
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-setuid-sandbox',
                '--no-sandbox',
                '--window-size=1920,1080'
            ],
            timeout: 60000
        });
    }

    async fetchWithPuppeteer(url) {
        if (!e.isGroup) return;
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        let browser;
        try {
            browser = await this._launchBrowser();
            const page = await browser.newPage();
            
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Referer': 'https://whatslink.info/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
            });

            let responseData;
            await page.goto(url, { 
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            // 双重解析策略
            try {
                const jsonContent = await page.$eval('div[hidden="true"]', div => div.textContent);
                responseData = JSON.parse(jsonContent);
            } catch (parseError) {
                responseData = await page.evaluate(() => {
                    try {
                        return JSON.parse(document.body.innerText);
                    } catch(e) {
                        return { error: "数据解析失败" };
                    }
                });
            }

            // 验证响应数据
            if (!responseData || typeof responseData !== 'object') {
                throw new Error('无效的响应数据格式');
            }

            return responseData;
        } catch (error) {
            console.error('Puppeteer操作失败:', error);
            throw new Error(`网站访问失败: ${error.message}`);
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }

    async fetchImageWithPuppeteer(imageUrl) {
        let browser;
        try {
            browser = await this._launchBrowser();
            const page = await browser.newPage();
            
            await page.setExtraHTTPHeaders({
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
                'Referer': 'https://whatslink.info/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
            });

            const response = await page.goto(imageUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
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

    async modifyImageWithPython(imageBuffer, imageName) {
        const tempImagePath = `./plugins/kkp-plugin/temp/temp_${Date.now()}_${imageName}.jpg`;
        const cleanUp = () => {
            if (fs.existsSync(tempImagePath)) {
                fs.unlinkSync(tempImagePath);
            }
        };

        try {
            fs.writeFileSync(tempImagePath, imageBuffer);
            const { stdout } = await execFileAsync(pythonCommand, [
                './plugins/kkp-plugin/modify_image.py',
                tempImagePath
            ]);

            const modifiedImagePath = stdout.trim();
            if (!fs.existsSync(modifiedImagePath)) {
                throw new Error('Python处理图片失败');
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

    async processMagnetLink(e) {
        let retryCount = 3;
        const retryDelay = 2000;
        
        while (retryCount-- > 0) {
            try {
                const matchedMagnet = e.msg.match(/^#验车(magnet:.+)$/)[1];
                const url = magnetURL(matchedMagnet);

                const response = await this.fetchWithPuppeteer(url);
                if (!response || response.error) {
                    throw new Error(response?.error || '无效的响应数据');
                }

                const msgData = [
                    `磁力链接：${matchedMagnet}\n\n`,
                    `文件名字：${response.name}\n`,
                    `文件类型：${response.file_type}\n`,
                    `文件数量：${response.count}\n`,
                    `文件大小：${(response.size / 1e9).toFixed(1)}GB\n`
                ];

                let screenshotData = [];
                if (response.screenshots?.length > 0) {
                    const processingPromises = response.screenshots
                        .slice(0, 9)
                        .map(async (s, index) => {
                            try {
                                const imageBuffer = await this.fetchImageWithPuppeteer(s.screenshot);
                                const modifiedBuffer = await this.modifyImageWithPython(imageBuffer, `screenshot_${index}`);
                                return `base64://${modifiedBuffer.toString('base64')}`;
                            } catch (error) {
                                console.error(`截图处理失败: ${error}`);
                                return null;
                            }
                        });

                    screenshotData = (await Promise.all(processingPromises)).filter(Boolean);
                }

                if (screenshotData.length === 0) {
                    screenshotData.push('该磁力无有效视频截图');
                }

                // 构建消息列表
                const msgList = [{
                    message: msgData.join(''),
                    nickname: e.user_id.toString(),
                    user_id: e.user_id
                }];

                screenshotData.forEach((screenshot, index) => {
                    msgList.push({
                        message: [`截图 ${index + 1}`, "\n", segment.image(screenshot)],
                        nickname: e.user_id.toString(),
                        user_id: e.user_id
                    });
                });

                // 发送合并转发消息
                const forwardMsg = e.isGroup 
                    ? await e.group.makeForwardMsg(msgList) 
                    : await e.friend.makeForwardMsg(msgList);

                // 处理消息撤回
                const recallConfig = this.getRecallConfig();
                const sentMessage = await e.reply(forwardMsg);

                if (recallConfig.recall) {
                    setTimeout(() => {
                        e.isGroup 
                            ? e.group.recallMsg(sentMessage.message_id) 
                            : e.friend.recallMsg(sentMessage.message_id);
                    }, recallConfig.time).unref();
                }

                return; // 成功则退出重试循环
            } catch (error) {
                console.error(`第${3 - retryCount}次尝试失败:`, error);
                if (retryCount > 0) {
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    await e.reply(`查询失败: ${error.message}`);
                }
            }
        }
    }
}