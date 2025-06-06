import puppeteer from 'puppeteer';

export class MZTPlugin extends plugin {
    constructor() {
        super({
            name: 'MZT图片提取插件',
            dsc: '从妹子图网站提取妹子的图片',
            event: 'message',
            priority: -Infinity,
            rule: [
                {
                    reg: '^#?妹子图(\\d+)$',
                    fnc: 'processMZTRequest'
                }
            ]
        });
    }

    async processMZTRequest(e) {
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        const match = e.msg.match(/^#?妹子图(\d+)$/);
        if (!match) return;

        const articleId = match[1];
        const baseUrl = `https://kkmzt.com/photo/${articleId}`;

        try {
            const browser = await puppeteer.launch({
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
                headless: 'new'
            });
            const page = await browser.newPage();

            await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

            await page.goto(baseUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 60000
            });

            const imageUrls = new Set();
            let imageCount = 0; // 记录已获取的图片数量

            // 获取初始页面上的图片
            let pageImages = await page.$$eval('img[referrerpolicy="origin"]', imgs => imgs.map(img => img.src));
            if (pageImages.length > 0) {
                for (const imgUrl of pageImages) {
                    if (imageCount >= 20) break;
                    imageUrls.add(imgUrl);
                    imageCount++;
                    console.log(`找到图片 (${imageCount}): ${imgUrl}`);
                }
            } else {
                console.log("在初始页面上未找到符合条件的图片");
            }

            // 如果初始页面的图片不足20张，尝试点击下一页获取更多
            while (imageCount < 20) {
                const nextButton = await page.$('div.uk-position-center-right.uk-overlay.uk-overlay-default.f-swich[action="next"]');
                if (!nextButton) {
                    console.log("未找到下一页按钮，结束爬取");
                    break;
                }

                console.log("点击了下一页按钮，等待1秒...");
                await nextButton.click();
                await new Promise(resolve => setTimeout(resolve, 1000));

                // 获取新的图片URL
                pageImages = await page.$$eval('img[referrerpolicy="origin"]', imgs => imgs.map(img => img.src));

                if (pageImages.length > 0) {
                    for (const imgUrl of pageImages) {
                        if (imageCount >= 20) break;
                        if (!imageUrls.has(imgUrl)) { // 确保不添加重复图片
                            imageUrls.add(imgUrl);
                            imageCount++;
                            console.log(`找到图片 (${imageCount}): ${imgUrl}`);
                        }
                    }
                } else {
                    console.log("在新页面上未找到符合条件的图片元素");
                }
            }

            await browser.close();
            const uniqueImageUrls = Array.from(imageUrls);
            console.log(`总共获取到 ${uniqueImageUrls.length} 张不重复的图片`);

            if (uniqueImageUrls.length === 0) {
                await e.reply("没有找到任何图片，请稍后再试。", true);
                return;
            }

            const messages = uniqueImageUrls.map(url => ({
                message: segment.image(url),
                nickname: e.user_id.toString(),
                user_id: e.user_id
            }));

            const forwardMsg = await Bot.makeForwardMsg(messages);
            await e.reply(forwardMsg);

        } catch (error) {
            console.error(`操作失败：${error.message}`);
            await e.reply("连接网页失败，请稍后再试", true);
        }
    }
}