import plugin from '../../../lib/plugins/plugin.js';
import puppeteer from 'puppeteer';

export class VideoSearch extends plugin {
    constructor() {
        super({
            name: '718吃瓜网视频搜索',
            dsc: '从718吃瓜视频站提取视频m3u8地址和文章内容',
            event: 'message',
            priority: '718',
            rule: [
                {
                    reg: '^#?吃瓜\\s*(\\S+)$',
                    fnc: 'processVideoSearch'
                },
                {
                    reg: '^#?吃瓜帮助$',
                    fnc: 'videoHelp'
                }
            ]
        });
        
        // 定义多个备用URL
        this.videoUrls = [
            'https://718.qiyaoba.net',
            'https://yule.qiyaoba.net',
            'https://y.718uc.com',
            'https://blog.yule52.net'
        ];
    }

    async videoHelp(e) {
        if (!e.isGroup) return;
        await this.reply([
            "【使用说明】",
            "命令格式：(#)吃瓜[文章ID]",
            "示例：(#)吃瓜123",
            "",
            "⚠️ 请遵守相关法律法规",
            "",
            "功能说明：",
            "1. 获取视频m3u8地址",
            "2. 提取文章内容（自动过滤评论和广告）",
            "3. 自行下载m3u8转mp4视频",
            "",
            "📢 更新：已添加多个备用站点提高成功率"
        ].join("\n"));
    }

    async processVideoSearch(e) {
        if (!e.isGroup) return;

        const videoId = e.msg.match(/^#?吃瓜\s*(\S+)$/)?.[1]?.trim();
        if (!videoId) return;

        await this.reply('正在搜索，请稍等...');

        const browser = await puppeteer.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            headless: 'new'
        });

        let lastError = null;
        
        // 尝试所有备用URL
        for (const baseUrl of this.videoUrls) {
            const url = `${baseUrl}/${videoId}`;
            try {
                const page = await browser.newPage();
                await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

                // 允许图片加载
                await page.setRequestInterception(true);
                page.on('request', req => {
                    if (['stylesheet', 'font'].includes(req.resourceType())) {
                        req.abort();
                    } else {
                        req.continue();
                    }
                });

                // 重试逻辑（3次）
                let retries = 3;
                while (retries--) {
                    try {
                        await page.goto(url, {
                            waitUntil: 'networkidle2',
                            timeout: 15000
                        });
                        break;
                    } catch (err) {
                        if (retries === 0) throw err;
                        await new Promise(r => setTimeout(r, 1000));
                    }
                }

                // 提取页面信息
                const pageInfo = await page.evaluate(() => {
                    try {
                        const result = {
                            title: null,
                            publishTime: null,
                            videoUrl: null,
                            images: [],
                            articleContent: []
                        };

                        // 提取标题
                        const titleElement = document.querySelector('h1.post-title');
                        if (titleElement) {
                            result.title = titleElement.textContent.trim();
                        }

                        // 提取发布时间
                        const timeElement = document.querySelector('time');
                        if (timeElement) {
                            result.publishTime = timeElement.textContent.trim();
                        }

                        // 提取DPlayer配置中的video.url
                        const dplayer = document.querySelector('.dplayer');
                        if (dplayer) {
                            const config = JSON.parse(dplayer.getAttribute('data-config'));
                            result.videoUrl = config.video?.url || null;
                        }

                        // 提取所有图片的src属性
                        const imgElements = document.querySelectorAll('img[src^="blob:"]');
                        imgElements.forEach(img => {
                            const imgUrl = img.getAttribute('src');
                            if (imgUrl) {
                                result.images.push(imgUrl);
                            }
                        });

                        // 提取并过滤文章内容
                        const excludeKeywords = [
                            '娱乐718', '娱乐 718', '最新地址', '官方吃瓜群', 
                            '点击加入', '点击下载', '下载', '看全集', '内有全集',
                            'OωO', '|´・ω・)ノ', 'ヾ(≧∇≦*)ゝ', '(☆ω☆)',
                            '（╯‵□′）╯︵┴─┴', '￣﹃￣', '(/ω＼)', '∠( ᐛ 」∠)＿',
                            '(๑•̀ㅁ•́ฅ)', '→_→', '୧(๑•̀⌄•́๑)૭', '٩(ˊᗜˋ*)و',
                            '(ノ°ο°)ノ', '(´இ皿இ｀)', '⌇●﹏●⌇', '(ฅ´ω`ฅ)',
                            '(╯°A°)╯︵○○○', 'φ(￣∇￣o)', 'ヾ(´･ ･｀｡)ノ"',
                            '( ง ᵒ̌皿ᵒ̌)ง⁼³₌₃', '(ó﹏ò｡)', 'Σ(っ °Д °;)っ',
                            '( ,,´･ω･)ﾉ"(´っω･｀｡)', '╮(╯▽╰)╭', 'o(*////▽////*)q',
                            '＞﹏＜', '( ๑´•ω•) "(ㆆᴗㆆ)', '(｡•ˇ‸ˇ•｡)', '颜文字'
                        ];

                        // 获取所有<p>标签，然后过滤掉在评论区域内的
                        const allPElements = document.querySelectorAll('p');
                        allPElements.forEach(p => {
                            // 检查是否在评论区域内
                            let isInComment = false;
                            let parent = p.parentElement;
                            
                            while (parent) {
                                if (parent.classList && parent.classList.contains('comment-content')) {
                                    isInComment = true;
                                    break;
                                }
                                parent = parent.parentElement;
                            }

                            if (!isInComment) {
                                const text = p.textContent.trim();
                                if (text && 
                                    !text.includes('视频播放异常') && 
                                    !excludeKeywords.some(keyword => text.includes(keyword)) &&
                                    !/^[^\u4e00-\u9fa5]*$/.test(text) // 排除纯符号和非中文内容
                                ) {
                                    result.articleContent.push(text);
                                }
                            }
                        });

                        return result;
                    } catch (e) {
                        console.error('解析页面信息失败:', e);
                        return null;
                    }
                });

                if (!pageInfo || !pageInfo.videoUrl) {
                    throw new Error('未找到视频地址');
                }

                // 清理URL
                const cleanUrl = pageInfo.videoUrl
                    .replace(/\\\//g, '/')
                    .split('?')[0];

                // 构建回复消息
                const replyMsg = [
                    `✅ 视频m3u8地址获取成功`,
                    `🆔 视频ID: ${videoId}`
                ];

                if (pageInfo.title) {
                    replyMsg.push(`📝 标题: ${pageInfo.title}`);
                }

                if (pageInfo.publishTime) {
                    replyMsg.push(`📅 发布时间: ${pageInfo.publishTime}`);
                }

                // 添加文章内容
                if (pageInfo.articleContent && pageInfo.articleContent.length > 0) {
                    replyMsg.push("", "📖 文章内容：");
                    replyMsg.push(...pageInfo.articleContent);
                }

                replyMsg.push(
                    "",
                    `🔗 m3u8地址: ${cleanUrl}`,
                    `ℹ️ 请自行下载m3u8转mp4视频`,
                    `📛 请勿用于非法用途`
                );

                // 构建转发消息节点
                const forwardNodes = [
                    {
                        user_id: e.user_id,
                        nickname: e.sender.nickname,
                        message: [
                            { type: 'text', text: replyMsg.join("\n") }
                        ]
                    }
                ];

                // 如果有图片，添加到转发消息节点
                if (pageInfo.images && pageInfo.images.length > 0) {
                    for (const blobUrl of pageInfo.images) {
                        try {
                            // 获取blob数据并转换为base64
                            const base64 = await page.evaluate(async (url) => {
                                const response = await fetch(url);
                                const blob = await response.blob();
                                return new Promise((resolve) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result);
                                    reader.readAsDataURL(blob);
                                });
                            }, blobUrl);

                            // 添加图片到转发消息节点
                            forwardNodes.push({
                                user_id: e.user_id,
                                nickname: e.sender.nickname,
                                message: [
                                    { type: 'image', file: base64 }
                                ]
                            });
                        } catch (err) {
                            console.error('处理blob图片失败:', err);
                        }
                    }
                }

                // 发送转发消息
                const forwardMessage = await Bot.makeForwardMsg(forwardNodes);
                await e.reply(forwardMessage);
                await page.close();
                await browser.close();
                return;

            } catch (error) {
                console.error(`[吃瓜] 在 ${url} 上出现错误: ${error.message}`);
                lastError = error;
                continue;
            }
        }

        // 所有URL尝试都失败后
        await browser.close();
        console.error(`[吃瓜] 所有镜像站点尝试失败: ${lastError?.message}`);
        await this.reply([
            "❌ 获取视频地址失败",
            `错误原因: ${lastError?.message || '未知错误'}`,
            "请检查：",
            "1. 视频ID是否正确",
            "2. 所有镜像站点均无法访问",
            "3. 若持续失败，请联系管理员"
        ].join("\n"));
    }
}
