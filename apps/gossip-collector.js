import plugin from "../../lib/plugins/plugin.js"
import puppeteer from "puppeteer"
import { segment } from "oicq"
import fs from "fs"
import path from "path"

export class VideoSearch extends plugin {
    constructor() {
        super({
            name: "718吃瓜网视频搜索",
            dsc: "从718吃瓜视频站提取视频m3u8地址和文章内容",
            event: "message",
            priority: "718",
            rule: [
                {
                    reg: "^#?吃瓜\\s*(\\d+)$",
                    fnc: "processVideoSearch"
                },
                {
                    reg: "^#?随机吃瓜$",
                    fnc: "randomVideoSearch"
                },
                {
                    reg: "^#?吃瓜搜索\\s*(\\S+)$",
                    fnc: "processSearchQuery"
                },
                {
                    reg: "^#?吃瓜(\\d+)个往期$",
                    fnc: "getPastArticles"
                },
                {
                    reg: "^#?可用吃瓜(id|ID)$",
                    fnc: "listAvailableIds",
                    ignoreCase: true
                }
            ]
        })

        this.videoUrls = [
            "https://risky.zuiniude.xyz",
            "https://cloud.zuiniude.xyz",
            "https://fence.zuiniude.xyz",
            "https://plane.zuiniude.xyz",
            "https://blend.zuiniude.xyz",
        ]
        
        this.excludedArticleIds = [
            19949,18914,18405,18185,16910,16790,14666,13619,12535,12489,
            12395,9999,9278,8819,7859,7293,6998,6692,2307,813,548,521,26,
        ].map(String);
        
        this.addArticleIds = [
            
        ];
        
        this.allArticleIds = [];
        this.finalArticleIds = [];
        
        this.loadingPromise = this.loadArticleIds();
    }
    
    async loadArticleIds() {
        try {
            const browser = await puppeteer.launch({
                args: ["--no-sandbox", "--disable-setuid-sandbox"],
                headless: "new"
            });
            
            const page = await browser.newPage();
            await page.setUserAgent(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            );

            await page.setRequestInterception(true);
            page.on('request', req => {
                if (['stylesheet', 'font', 'image', 'media', 'script'].includes(req.resourceType())) {
                    req.abort();
                } else {
                    req.continue();
                }
            });

            await page.goto(`${this.videoUrls[0]}/archives.html`, {
                timeout: 120000,
                waitUntil: "domcontentloaded"
            });

            await this.autoScrollToBottom(page);

            await page.waitForFunction(() => {
                const brickCount = document.querySelectorAll('.brick').length;
                return new Promise(resolve => {
                    let lastCount = brickCount;
                    setTimeout(() => {
                        const newCount = document.querySelectorAll('.brick').length;
                        resolve(newCount === lastCount);
                    }, 2000);
                });
            }, { timeout: 60000 });

            const scrapedIds = await page.evaluate(() => {
                const bricks = Array.from(document.querySelectorAll('.brick'));
                return bricks.map(brick => {
                    const link = brick.querySelector('a[href^="/archives/"]');
                    if (!link) return null;
                    const href = link.href || link.getAttribute('data-original-url');
                    const match = href.match(/\/archives\/(\d+)/);
                    return match ? match[1] : null;
                }).filter(Boolean);
            });

            this.finalArticleIds = this.processArticleIds(scrapedIds);
            
            logger.info(`成功加载 ${this.finalArticleIds.length} 个文章ID`);
            logger.debug(`ID范围: ${Math.min(...this.finalArticleIds.map(Number))}-${Math.max(...this.finalArticleIds.map(Number))}`);
            
            await browser.close();
            return true;
        } catch (error) {
            logger.error("加载文章ID失败:", error);
            this.finalArticleIds = this.getFallbackIds();
            return false;
        }
    }

    async autoScrollToBottom(page) {
        await page.evaluate(async () => {
            await new Promise((resolve) => {
                let totalHeight = 0;
                const distance = 500;
                const scrollDelay = 300;
                
                const timer = setInterval(() => {
                    const scrollHeight = document.body.scrollHeight;
                    window.scrollBy(0, distance);
                    totalHeight += distance;

                    if (totalHeight >= scrollHeight - window.innerHeight || totalHeight > 50000) {
                        clearInterval(timer);
                        resolve();
                    }
                }, scrollDelay);
            });
        });
    }

    getFallbackIds() {
        return this.addArticleIds
            .filter(id => !this.excludedArticleIds.includes(id));
    }

    processArticleIds(scrapedIds) {
        const allIds = [...new Set([...scrapedIds, ...this.addArticleIds])];
        return allIds
            .filter(id => !this.excludedArticleIds.includes(id))
            .sort((a, b) => parseInt(b) - parseInt(a));
    }

    async processVideoSearch(e) {
        await this.loadingPromise;
        
        const match = e.msg.match(/^#?吃瓜\s*(\d+)$/);
        if (!match) return;
        
        const videoId = match[1];
        if (this.excludedArticleIds.includes(videoId)) {
            await e.reply("该文章 ID 已被排除，无法搜索。", false, { at: true });
            return;
        }

        if (!this.finalArticleIds.includes(videoId)) {
            await e.reply("该ID不存在", false, { at: true });
            return;
        }

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: "new"
        });

        let lastError = null;

        for (const baseUrl of this.videoUrls) {
            const url = `${baseUrl}/archives/${videoId}`;
            try {
                const page = await browser.newPage();
                await page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                );

                await page.setRequestInterception(true);
                page.on('request', req => {
                    if (['stylesheet', 'font'].includes(req.resourceType())) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });

                let retries = 3;
                while (retries--) {
                    try {
                        await page.goto(url, {
                            timeout: 60000,
                            waitUntil: "networkidle2"
                        });
                        break;
                    } catch (err) {
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 60000));
                    }
                }

                const pageInfo = await page.evaluate(() => {
                    try {
                        const result = {
                            title: null,
                            publishTime: null,
                            videoUrls: [],
                            images: [],
                            articleContent: [],
                            publishedTime: null,
                            modifiedTime: null,
                        };

                        const titleElement = document.querySelector("h1.post-title");
                        if (titleElement) result.title = titleElement.textContent.trim();

                        const timeElement = document.querySelector("time");
                        if (timeElement) result.publishTime = timeElement.textContent.trim();

                        const publishedTimeMeta = document.querySelector('meta[property="article:published_time"]');
                        if (publishedTimeMeta) result.publishedTime = publishedTimeMeta.content;

                        const modifiedTimeMeta = document.querySelector('meta[property="article:modified_time"]');
                        if (modifiedTimeMeta) result.modifiedTime = modifiedTimeMeta.content;

                        const dplayers = document.querySelectorAll(".dplayer");
                        if (dplayers.length > 0) {
                            dplayers.forEach(dplayer => {
                                try {
                                    const config = JSON.parse(dplayer.getAttribute("data-config"));
                                    if (config.video?.url) {
                                        result.videoUrls.push(config.video.url);
                                    }
                                } catch (e) {
                                    console.error("解析DPlayer配置失败:", e);
                                }
                            });
                        }

                        if (result.videoUrls.length === 0) {
                            const videoElements = document.querySelectorAll("video.dplayer-video");
                            videoElements.forEach(video => {
                                const src = video.getAttribute("src");
                                if (src) result.videoUrls.push(src);
                            });
                        }

                        const imgElements = document.querySelectorAll('img[src^="blob:"]');
                        imgElements.forEach(img => {
                            let isAd = false;
                            let parent = img.parentElement;
                            
                            while (parent) {
                                if (parent.classList && 
                                   (parent.classList.contains('horizontal-banner') || 
                                    parent.classList.contains('article-bottom-apps'))) {
                                    isAd = true;
                                    break;
                                }
                                parent = parent.parentElement;
                            }

                            const imgUrl = img.getAttribute('src');
                            if (imgUrl && !isAd) result.images.push(imgUrl);
                        });

                        // 提取并过滤文章内容
                        const excludeKeywords = [
                            "娱乐718",
                            "娱乐 718",
                            "最新地址",
                            "官方吃瓜群",
                            "点击加入",
                            "点击下载",
                            "下载",
                            "看全集",
                            "内有全集",
                            "OωO",
                            "|´・ω・)ノ",
                            "ヾ(≧∇≦*)ゝ",
                            "(☆ω☆)",
                            "（╯‵□′）╯︵┴─┴",
                            "￣﹃￣",
                            "(/ω＼)",
                            "∠( ᐛ 」∠)＿",
                            "(๑•̀ㅁ•́ฅ)",
                            "→_→",
                            "୧(๑•̀⌄•́๑)૭",
                            "٩(ˊᗜˋ*)و",
                            "(ノ°ο°)ノ",
                            "(´இ皿இ｀)",
                            "⌇●﹏●⌇",
                            "(ฅ´ω`ฅ)",
                            "(╯°A°)╯︵○○○",
                            "φ(￣∇￣o)",
                            'ヾ(´･ ･｀｡)ノ"',
                            "( ง ᵒ̌皿ᵒ̌)ง⁼³₌₃",
                            "(ó﹏ò｡)",
                            "Σ(っ °Д °;)っ",
                            '( ,,´･ω･)ﾉ"(´っω･｀｡)',
                            "╮(╯▽╰)╭",
                            "o(*////▽////*)q",
                            "＞﹏＜",
                            '( ๑´•ω•) "(ㆆᴗㆆ)',
                            "(｡•ˇ‸ˇ•｡)",
                            "颜文字",
                            "本网站包含有年龄限制的内容",
                            "包括裸体和露骨色情素材的内容。",
                            "点击继续即表示您确认您已年满 18",
                            "岁",
                            "或在您访问本网站时所在的司法管辖区已是成年人",
                            "播放异常",
                            "？请刷新",
                            "发邮件获取",
                            "最新网址",
                            "👇",
                            "长按复制保存",
                            "718yule@pm.me",
                            "更新完以后",
                            "有兄弟反馈看不了",
                            "请留言",
                            "手机型号",
                            "浏览器",
                            "网络情况",
                            "小编来解决",
                            "吃瓜",
                            "718",
                            "永久地址",
                            "立志挖掘网红反差婊",
                            "萝莉最新",
                            "最劲爆",
                            "最硬核的吃瓜内容！",
                            "记得分享给你的朋友",
                            "一起嗨翻吃瓜圈！",
                            "吃瓜718永久地址 (需翻墙访问)",
                            "https://www.718yule.com",
                            "Copyright",
                            "©",
                            "2025 吃瓜718",
                            "Powered by",
                            "吃瓜718",
                        ]

                        document.querySelectorAll("p").forEach((p) => {
                            let isInComment = false;
                            let parent = p.parentElement;

                            while (parent) {
                                if (parent.classList?.contains("comment-content")) {
                                    isInComment = true;
                                    break;
                                }
                                parent = parent.parentElement;
                            }

                            if (!isInComment) {
                                const text = p.textContent.trim();
                                if (text && !text.includes("视频播放异常") &&
                                    !excludeKeywords.some(keyword => text.includes(keyword)) &&
                                    !/^[^\u4e00-\u9fa5]*$/.test(text)) {
                                    result.articleContent.push(text);
                                }
                            }
                        });

                        return result;
                    } catch (e) {
                        console.error("解析页面信息失败:", e);
                        return null;
                    }
                });

                if (!pageInfo || (pageInfo.videoUrls.length === 0 && pageInfo.articleContent.length === 0 && pageInfo.images.length === 0)) {
                    throw new Error("未找到视频地址、文章正文内容和图片");
                }

                const forwardNodes = [{
                    user_id: e.user_id,
                    nickname: e.sender.nickname,
                    message: [
                        `✅视频信息获取成功！\n` +
                        `🆔文章ID: ${videoId}\n` +
                        (pageInfo.title ? `📝标题: ${pageInfo.title}\n` : '') +
                        (pageInfo.publishTime ? `📅发布时间: ${pageInfo.publishTime}\n` : '') +
                        (pageInfo.publishedTime ? `📅创建时间: ${pageInfo.publishedTime}\n` : '') +
                        (pageInfo.modifiedTime ? `📅最后修改时间: ${pageInfo.modifiedTime}\n` : '') +
                        `📛请勿用于非法用途`
                    ]
                }];

                if (pageInfo.videoUrls.length > 0) {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: ["🔗视频地址列表:"]
                    });
                    
                    pageInfo.videoUrls.forEach((url, index) => {
                        let cleanUrl = url;
                        if (parseInt(videoId) >= 19949) {
                            cleanUrl = url;
                        } else if (url) {
                            cleanUrl = url.replace(/\\\//g, "/").split("?")[0];
                        }
                        
                        forwardNodes.push({
                            user_id: e.user_id,
                            nickname: e.sender.nickname,
                            message: [`${index + 1}. ${cleanUrl}`]
                        });
                    });
                } else {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: ["ℹ️未获取到视频地址"]
                    });
                }

                if (pageInfo.articleContent.length > 0) {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: ["📖文章内容:"]
                    });

                    pageInfo.articleContent.forEach(content => {
                        forwardNodes.push({
                            user_id: e.user_id,
                            nickname: e.sender.nickname,
                            message: [content]
                        });
                    });
                }

                if (pageInfo.images.length > 0) {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: ["🖼️文章图片:"]
                    });

                    for (const blobUrl of pageInfo.images) {
                        try {
                            const base64 = await page.evaluate(async (url) => {
                                const response = await fetch(url);
                                const blob = await response.blob();
                                return new Promise((resolve) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                    reader.readAsDataURL(blob);
                                });
                            }, blobUrl);

                            forwardNodes.push({
                                user_id: e.user_id,
                                nickname: e.sender.nickname,
                                message: [segment.image(`base64://${base64}`)]
                            });
                        } catch (imageError) {
                            logger.error('获取图片失败:', imageError);
                        }
                    }
                }

                const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
                await e.reply(forwardMessage);

                await browser.close();
                return;
            } catch (error) {
                lastError = error;
                logger.error(`尝试URL ${url} 失败:`, error);
            }
        }

        await browser.close();
        await e.reply(`未找到视频地址，请稍后重试。错误信息: ${lastError?.message || "未知错误"}`, false, { at: true });
    }

    async randomVideoSearch(e) {
        await this.loadingPromise;

        if (this.finalArticleIds.length === 0) {
            await e.reply("没有可用的随机视频ID，请检查文章id", false, { at: true });
            return;
        }

        const randomIndex = Math.floor(Math.random() * this.finalArticleIds.length);
        const randomVideoId = this.finalArticleIds[randomIndex];

        await e.reply(`随机选择视频ID: ${randomVideoId}，正在搜索...`, false, { at: true });

        await this.processVideoSearch({
            ...e,
            msg: `#吃瓜 ${randomVideoId}`
        });
    }

    async processSearchQuery(e) {
        const keyword = e.msg.match(/^#?吃瓜搜索\s*(\S+)$/)?.[1]?.trim();
        if (!keyword) return;

        await e.reply(`正在搜索包含关键词 "${keyword}" 的文章，请稍等...`, false, { at: true });

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: "new"
        });

        let lastError = null;

        for (const baseUrl of this.videoUrls) {
            const searchUrl = `${baseUrl}/search/${encodeURIComponent(keyword)}`;
            try {
                const page = await browser.newPage();
                await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

                await page.setRequestInterception(true);
                page.on('request', req => {
                    if (['stylesheet', 'font'].includes(req.resourceType())) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });

                let retries = 3;
                while (retries--) {
                    try {
                        await page.goto(searchUrl, {
                            timeout: 60000,
                            waitUntil: "networkidle2"
                        });
                        break;
                    } catch (err) {
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 60000));
                    }
                }

                const searchResults = await page.evaluate(() => {
                    const articles = Array.from(document.querySelectorAll('article'));
                    return articles.map(article => {
                        const titleElement = article.querySelector('h2.post-card-title');
                        const linkElement = article.querySelector('a[href^="/archives/"]');

                        if (!titleElement || !linkElement) return null;

                        const link = linkElement.href;
                        const title = titleElement.textContent.trim();
                        const idMatch = link.match(/\/archives\/(\d+)/);
                        const id = idMatch ? idMatch[1] : null;

                        return id && title ? { id, title, link } : null;
                    }).filter(Boolean);
                });

                if (searchResults.length === 0) {
                    throw new Error("未找到相关文章");
                }

                const forwardNodes = [{
                    user_id: e.user_id,
                    nickname: e.sender.nickname,
                    message: [`🔍包含关键词 "${keyword}" 的文章搜索结果：`]
                }];

                searchResults.slice(0, 30).forEach((result, index) => {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: [
                            `${index + 1}. ${result.title}\n`,
                            `📌 ID: ${result.id}`,
                        ]
                    });
                });

                const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
                await e.reply(forwardMessage);

                await page.close();
                await browser.close();
                return;
            } catch (error) {
                lastError = error;
                logger.error(`尝试 URL ${searchUrl} 失败:`, error);
            }
        }

        await browser.close();
        await e.reply(`❌ 未找到相关文章，请稍后重试。错误信息: ${lastError?.message || "未知错误"}`, false, { at: true });
    }

    async getPastArticles(e) {
        const count = parseInt(e.msg.match(/^#?吃瓜(\d+)个往期$/)?.[1], 10);
        if (!count) return;

        await e.reply(`正在获取 ${count} 个往期文章，请稍等...`, false, { at: true });

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: "new"
        });

        let lastError = null;

        for (const baseUrl of this.videoUrls) {
            const archiveUrl = `${baseUrl}/archives.html`;
            try {
                const page = await browser.newPage();
                await page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                );

                await page.setRequestInterception(true);
                page.on('request', req => {
                    if (['stylesheet', 'font'].includes(req.resourceType())) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });

                let retries = 3;
                while (retries--) {
                    try {
                        await page.goto(archiveUrl, {
                            timeout: 60000,
                            waitUntil: "networkidle2"
                        });
                        break;
                    } catch (err) {
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 60000));
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 5000));

                const archiveInfo = await page.evaluate((count) => {
                    const result = [];
                    const brickElements = document.querySelectorAll('.brick a');
                    const actualCount = Math.min(count, brickElements.length);

                    for (let i = 0; i < actualCount; i++) {
                        const brick = brickElements[i];
                        const href = brick.getAttribute('href');
                        const titleElement = brick.cloneNode(true);
                        const spanElement = titleElement.querySelector('span');
                        if (spanElement) spanElement.remove();
                        
                        const title = titleElement.textContent.trim();
                        const idMatch = href.match(/\/archives\/(\d+)/);
                        const id = idMatch ? idMatch[1] : null;

                        if (id) result.push({ title, id, link: href });
                    }

                    return result;
                }, count);

                if (archiveInfo.length === 0) {
                    throw new Error("未找到往期文章");
                }

                const forwardNodes = [{
                    user_id: e.user_id,
                    nickname: e.sender.nickname,
                    message: [`以下是 ${archiveInfo.length} 个往期文章的信息：`]
                }];

                archiveInfo.forEach((article, index) => {
                    forwardNodes.push({
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: [
                            `${index + 1}. 📝标题: ${article.title}\n`,
                            `🆔ID: ${article.id}\n`,
                        ]
                    });
                });

                const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
                await e.reply(forwardMessage);

                await page.close();
                await browser.close();
                return;
            } catch (error) {
                lastError = error;
                logger.error(`尝试URL ${archiveUrl} 失败:`, error);
            }
        }

        await browser.close();
        await e.reply(`未找到往期文章，请稍后重试。错误信息: ${lastError.message}`, false, { at: true });
    }

    async listAvailableIds(e) {
        await this.loadingPromise;

        if (this.finalArticleIds.length === 0) {
            await e.reply("没有可用的文章ID", false, { at: true });
            return;
        }

        // 先发送统计信息
        await e.reply(
            `📋 可用吃瓜ID列表 (共${this.finalArticleIds.length}个)\n` +
            `📊 统计信息:\n` +
            `🔢 总数量: ${this.finalArticleIds.length}\n` +
            `🔝 最大ID: ${Math.max(...this.finalArticleIds.map(Number))}\n` +
            `🔻 最小ID: ${Math.min(...this.finalArticleIds.map(Number))}\n` +
            `🔄 最后更新: ${new Date().toLocaleString()}\n` +
            `正在分段发送ID列表，请稍候...`,
            false, { at: true }
        );

        // 分批发送ID，每批50个
        const batchSize = 50;
        const totalBatches = Math.ceil(this.finalArticleIds.length / batchSize);
        
        for (let i = 0; i < this.finalArticleIds.length; i += batchSize) {
            const batch = this.finalArticleIds.slice(i, i + batchSize);
            const currentBatch = Math.ceil(i / batchSize) + 1;
            
            try {
                await e.reply(
                    `📋 可用ID列表 (${currentBatch}/${totalBatches})\n` +
                    `ID范围: ${batch[0]} - ${batch[batch.length-1]}\n` +
                    `${batch.join(', ')}`,
                    false, { at: true }
                );
                
                await new Promise(resolve => setTimeout(resolve, 1000));
            } catch (error) {
                logger.error(`发送第${currentBatch}批ID失败:`, error);
                await e.reply(`发送第${currentBatch}批ID失败，将继续尝试下一批`, false, { at: true });
            }
        }

        await e.reply("✅ 所有可用ID列表已发送完毕", false, { at: true });
    }
}