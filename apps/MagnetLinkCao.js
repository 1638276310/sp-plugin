import plugin from '../../../lib/plugins/plugin.js';
import puppeteer from 'puppeteer';



    const DEFAULT_HEADERS = {
        'Accept': '*/*',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Host': 'www.cilicao.me',
        'Origin': 'https://www.cilicao.me',
        'Referer': 'https://www.cilicao.me/list.php',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
        'X-Requested-With': 'XMLHttpRequest'
    };

    export class Cao extends plugin {
        constructor() {
            super({
                name: 'Y:磁力草',
                dsc: '磁力草',
                event: 'message',
                priority: '88',
                rule: [{
                    reg: '^#?磁力草(.*)$',
                    fnc: 'MagnetLinkcao'
                }]
            });
        }

    async MagnetLinkcao(e) {
        // if (!e.isGroup) return;
        const match = e.msg.match(/^#?磁力草\s*(\S+)(?:\s+(\S+))?$/);
        if (!match) {
            return;
        }
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        const userInput = match[1];
        const sortOrder = match[2];
        let orderParam = "";
        if (sortOrder) {
            switch (sortOrder) {
                case '热度':
                    orderParam = "&order=fangwen";
                    break;
                case '大小':
                    orderParam = "&order=length";
                    break;
            }
        }
        const url = `https://www.cilicao.me/search.php?name=${encodeURIComponent(userInput)}&page=1${orderParam}`;

        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: true
        });
        const page = await browser.newPage();

        try {
            await page.goto(url, {
                waitUntil: 'load',
                timeout: 150000
            });
            const searchResults = await page.$$('.card.border-dashed.border-2.mb-2');

            if (!searchResults.length) {
                await this.reply('未找到磁力链接');
                await browser.close();
                return;
            }

            const results = [];

            for (let element of searchResults) {
                try {
                    const magnetA = await element.$('a[onclick]');
                    if (!magnetA) continue;

                    const onclickData = await magnetA.evaluate(a => a.getAttribute('onclick'));
                    const match = onclickData.match(/xiangqing\('(\d)','(\w{64})'\)/);

                    if (!match) continue;

                    const sjk = match[1];
                    const hash = match[2];
                    const formData = new URLSearchParams();
                    formData.append('typenum', 4);
                    formData.append('md5hash', hash);
                    formData.append('sjk', sjk);

                    const response = await fetch('https://www.cilicao.me/ajax2.php', {
                        method: 'POST',
                        headers: DEFAULT_HEADERS,
                        body: formData
                    });

                    const data = await response.json();
                    if (data.code !== 1) {
                        continue;
                    }

                    const trueMagnetLink = `magnet:?xt=urn:btih:${data.info_hash}`;
                    const title = await element.$eval('h5.card-title a', el => el.innerText.trim());
                    let details = '';
                    const detailsElement = await element.$('p.card-text.mb-1');
                    if (detailsElement) {
                        details = await detailsElement.evaluate(el => el.innerText.replace(/\|/g, '\n').trim());
                    }
                    const message = `${title}\r\r${trueMagnetLink}\r\r${details}`;
                    results.push({
                        user_id: e.user_id,
                        nickname: e.user_id,
                        message
                    });
                } catch (error) {
                    logger.error(`处理单个元素错误: ${error.toString()}`);
                }
            }

            if (results.length === 0) {
                await this.reply('未找到有效的磁力链接');
            } else {
                const forwardMsg = await Bot.makeForwardMsg(results);
                await e.reply(forwardMsg);
            }

        } catch (error) {
            logger.error(`在URL ${url} 上出现错误：${error.toString()}`);
            await this.reply(`在URL ${url} 上出现错误：${error.toString()}`);
        } finally {
            await browser.close();
        }
    }
}