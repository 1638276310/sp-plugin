import plugin from '../../../lib/plugins/plugin.js';
import puppeteer from 'puppeteer';

export class MagnetLink extends plugin {
    constructor() {
        super(
            {
                name: '磁力猫搜索',
                dsc: '磁力猫搜索',
                event: 'message',
                priority: '77',
                rule: [
                    {
                        reg: '^#?磁力猫(.*)$',
                        fnc: 'processMagnetLink'
                    },
                    {
                        reg: '^#?磁力帮助$',
                        fnc: 'magnetHelp'
                    }
                ]
            }
        )
    }

    async magnetHelp(e) {
        if (!e.isGroup) return;
        let helpText = "#磁力猫支持搜索格式  #磁力猫[搜索内容] [全部/影视/音乐/图像/文档/压缩包/安装包/其他] [相关度/文件大小/添加时间/热度/最近下载] [结果数量]\n"
        helpText += "如#磁力猫ipx  #磁力猫ipx 全部 热度 20  #磁力猫ipx 影视 添加时间\n\n"
        helpText += "注意：搜索结果可能包含成人内容，请谨慎使用"
        await this.reply(helpText);
    }

    async processMagnetLink(e) {
        if (!e.isGroup) return;
        let match = e.msg.match(/^#?磁力猫\s*(\S+)(\s+(\S+))?(\s+(\S+))?(\s+(\d+))?$/);
        if (!match) {
            return;
        }

        const userInput = encodeURIComponent(match[1]);
        const fileType = this.fileTypeMap[match[3]] ?? 0;
        const orderType = this.orderTypeMap[match[5]] ?? 0;
        const resultCount = parseInt(match[7]) || 10;

        const urls = [
            `https://izgjuzya.8800461.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
            `https://onqedydj.8800462.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
            `https://edhpvzgi.8800463.xyz/search-${userInput}-${fileType}-${orderType}-1.html`,
        ];

        const browser = await puppeteer.launch({ 
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        let page;

        for (let i = 0; i < urls.length; i++) {
            try {
                page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                await page.goto(urls[i], { 
                    waitUntil: 'domcontentloaded', 
                    timeout: 10000 
                });
                
                // 等待结果加载
                await page.waitForSelector('.ssbox', { timeout: 5000 });

                const searchResults = await page.$$('.ssbox');
                if (searchResults.length === 0) {
                    await this.reply('搜索失败，正在尝试下个链接');
                    await page.close();
                    continue;
                }

                const results = [];
                for (let i = 0; i < Math.min(resultCount, searchResults.length); i++) {
                    const result = searchResults[i];
                    
                    // 提取标题
                    const title = await result.$eval('.title h3 a', el => el.textContent.trim());
                    
                    // 提取磁力链接
                    const magnetLink = await result.$eval('.sbar a[href^="magnet:"]', el => el.href);
                    
                    // 提取元数据
                    const metadata = await result.$$eval('.sbar span', spans => {
                        const data = {};
                        spans.forEach(span => {
                            const text = span.textContent;
                            if (text.includes('添加时间')) {
                                data.addedTime = span.querySelector('b').textContent;
                            } else if (text.includes('大小')) {
                                data.size = span.querySelector('.yellow-pill').textContent;
                            } else if (text.includes('最近下载')) {
                                data.recentDownload = span.querySelector('b').textContent;
                            } else if (text.includes('热度')) {
                                data.heat = span.querySelector('b').textContent;
                            }
                        });
                        return data;
                    });

                    results.push({
                        user_id: e.user_id,
                        nickname: e.user_id,
                        message: `${title}\n\n${magnetLink}\n\n添加时间：${metadata.addedTime}\n大小：${metadata.size}\n最近下载：${metadata.recentDownload}\n热度：${metadata.heat}`
                    });
                }

                if (results.length > 0) {
                    const forwardMsg = await e.group.makeForwardMsg(results);
                    await this.reply(forwardMsg);
                    await browser.close();
                    return;
                } else {
                    await this.reply("未找到磁力链接");
                    await page.close();
                    continue;
                }
            }
            catch (error) {
                console.log(`在URL ${urls[i]} 上出现错误：${error.toString()}`);
                if (page) await page.close();
                continue;
            }
        }
        await this.reply('所有链接均无搜索结果');
        await browser.close();
    }

    // 文件类型映射表
    fileTypeMap = {
        '全部': 0,
        '影视': 1,
        '音乐': 2,
        '图像': 3,
        '文档': 4,
        '压缩包': 5,
        '安装包': 6,
        '其他': 7
    };

    // 排序类型映射表
    orderTypeMap = {
        '相关度': 0,
        '文件大小': 1,
        '添加时间': 2,
        '热度': 3,
        '最近下载': 4
    };
}