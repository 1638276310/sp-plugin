import plugin from "../../../lib/plugins/plugin.js"
import puppeteer from "puppeteer"

export class VideoSearch extends plugin {
    constructor() {
        super({
            name: "718吃瓜网视频搜索",
            dsc: "从718吃瓜视频站提取视频m3u8地址和文章内容",
            event: "message",
            priority: "718",
            rule: [
                {
                    reg: "^#?吃瓜\\s*(\\S+)$",
                    fnc: "processVideoSearch"
                },
                {
                    reg: "^#?718帮助$",
                    fnc: "videoHelp"
                }
            ]
        })

        // 定义多个备用URL
        this.videoUrls = [
            //'https://apple.zuiniude.xyz',
            //'https://scout.zuiniude.xyz',
            //'https://www.718yule.com',
            "https://risky.zuiniude.xyz",
            "https://cloud.zuiniude.xyz",
            "https://fence.zuiniude.xyz",
            "https://plane.zuiniude.xyz",
            "https://blend.zuiniude.xyz",
            "https://clout.zuiniude.xyz",
            "https://roast.zuiniude.xyz",
            "https://fizzy.zuiniude.xyz",
            "https://roast.zuiniude.xyz",
            "https://spunk.zuiniude.xyz",
            "https://giddy.liuliangqifei.xyz",
            "https://chuck.liuliangqifei.xyz",
            "https://whiff.liuliangqifei.xyz",
            "https://light.liuliangqifei.xyz",
            "https://stash.liuliangqifei.xyz",
            "https://grain.liuliangqifei.xyz",
            "https://fence.liuliangqifei.xyz",
            "https://flame.kuaidianlaill.com",
            "https://plume.liuliangqifei.xyz",
            "https://stark.liuliangqifei.xyz",
            "https://scarf.kuaidianlaill.com",
            "https://slope.liuliangqifei.xyz",
            "https://chess.kuaidianlaill.com",
            "https://gravy.kuaidianlaill.com",
            "https://crush.kuaidianlaill.com",
            "https://crush.kuaidianlaill.com",
            "https://fling.kuaidianlaill.com",
            "https://creek.liuliangqifei.xyz",
            "https://chest.kuaidianlaill.com",
            "https://whale.kuaidianlaill.com",
            "https://flare.kuaidianlaill.com",
            "https://spark.kuaidianlaill.com",
            "https://brave.kuaidianlaill.com",
            "https://swarm.kuaidianlaill.com",
            "https://swish.kuaidianlaill.com"
        ]
    }

    async videoHelp(e) {
        if (!e.isGroup) return
        await this.reply(
            [
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
            ].join("\n")
        )
    }

    async processVideoSearch(e) {
        if (!e.isGroup) return
        const videoId = e.msg.match(/^#?吃瓜\s*(\S+)$/)?.[1]?.trim()
        if (!videoId) return

        await this.reply("正在搜索，请稍等...")

        const browser = await puppeteer.launch({
            args: ["--no-sandbox", "--disable-setuid-sandbox"],
            headless: "new"
        })

        let lastError = null

        // 尝试所有备用URL
        for (const baseUrl of this.videoUrls) {
            const url = `${baseUrl}/archives/${videoId}`
            try {
                const page = await browser.newPage()
                await page.setUserAgent(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                )

                // 允许图片加载
                await page.setRequestInterception(true)
                page.on("request", (req) => {
                    if (["stylesheet", "font"].includes(req.resourceType())) {
                        req.abort()
                    } else {
                        req.continue()
                    }
                })

                // 重试逻辑（3次）
                let retries = 3
                while (retries--) {
                    try {
                        // 去掉 waitUntil 选项，等待所有资源加载完成
                        await page.goto(url, {
                            timeout: 100000
                        })
                        break
                    } catch (err) {
                        if (retries === 0) throw err
                        await new Promise((r) => setTimeout(r, 10000))
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
                        }

                        // 提取标题
                        const titleElement = document.querySelector("h1.post-title")
                        if (titleElement) {
                            result.title = titleElement.textContent.trim()
                        }

                        // 提取发布时间
                        const timeElement = document.querySelector("time")
                        if (timeElement) {
                            result.publishTime = timeElement.textContent.trim()
                        }

                        // 提取DPlayer配置中的video.url
                        const dplayer = document.querySelector(".dplayer")
                        if (dplayer) {
                            const config = JSON.parse(dplayer.getAttribute("data-config"))
                            result.videoUrl = config.video?.url || null
                        }

                        // 提取所有图片的src属性
                        const imgElements = document.querySelectorAll('img[src^="blob:"]')
                        imgElements.forEach((img) => {
                            const imgUrl = img.getAttribute("src")
                            if (imgUrl) {
                                result.images.push(imgUrl)
                            }
                        })

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
                        ]

                        // 获取所有<p>标签，然后过滤掉在评论区域内的
                        const allPElements = document.querySelectorAll("p")
                        allPElements.forEach((p) => {
                            // 检查是否在评论区域内
                            let isInComment = false
                            let parent = p.parentElement

                            while (parent) {
                                if (
                                    parent.classList &&
                                    parent.classList.contains("comment-content")
                                ) {
                                    isInComment = true
                                    break
                                }
                                parent = parent.parentElement
                            }

                            if (!isInComment) {
                                const text = p.textContent.trim()
                                if (
                                    text &&
                                    !text.includes("视频播放异常") &&
                                    !excludeKeywords.some((keyword) => text.includes(keyword)) &&
                                   !/^[^\u4e00-\u9fa5]*$/.test(text) // 排除纯符号和非中文内容
                                ) {
                                    result.articleContent.push(text)
                                }
                            }
                        })

                        return result
                    } catch (e) {
                        logger.error("解析页面信息失败:", e)
                        return null
                    }
                })

                if (!pageInfo || !pageInfo.videoUrl) {
                    throw new Error("未找到视频地址")
                }

                // 清理URL
                const cleanUrl = pageInfo.videoUrl.replace(/\\\//g, "/").split("?")[0]

                // 构建回复消息
                const replyMsg = [
                    `✅ 视频m3u8地址获取成功`,
                    `\`\`\`json${url}\`\`\``,
                    `🆔 视频ID: ${videoId}`
                ]

                if (pageInfo.title) {
                    replyMsg.push(`📝 标题: ${pageInfo.title}`)
                }

                if (pageInfo.publishTime) {
                    replyMsg.push(`📅 发布时间: ${pageInfo.publishTime}`)
                }

                // 添加文章内容
                if (pageInfo.articleContent && pageInfo.articleContent.length > 0) {
                    replyMsg.push("", "📖 文章内容：")
                    replyMsg.push(...pageInfo.articleContent)
                }

                replyMsg.push(
                    "",
                    `🔗 m3u8地址:`,
                    `\`\`\`json${cleanUrl}\`\`\``,
                    `ℹ️ 请自行下载m3u8转mp4视频`,
                    `📛 请勿用于非法用途`
                )

                // 构建转发消息节点
                const forwardNodes = replyMsg.join("\n")
                const images = []
                // 如果有图片，添加到转发消息节点
                if (pageInfo.images && pageInfo.images.length > 0) {
                    for (const blobUrl of pageInfo.images) {
                        try {
                            // 获取blob数据并转换为base64
                            const base64 = await page.evaluate(async (url) => {
                                const response = await fetch(url)
                                const blob = await response.blob()
                                return new Promise((resolve) => {
                                    const reader = new FileReader()
                                    reader.onloadend = () => resolve(reader.result)
                                    reader.readAsDataURL(blob)
                                })
                            }, blobUrl)

                            // 添加图片到转发消息节点
							images.push({
								type: "image",
								data: {
									file: base64
								}
							})
						} catch (err) {
							logger.error("处理blob图片失败:", err)
						}
					}
				}

				const requestBody = {
					group_id: e.group_id,
					user_id: e.user_id,
					message: [
						{
							type: "node",
							data: {
								nickname: e.sender.nickname,
								user_id: e.user_id,
								content: [
									{
										type: "node",
										data: {
											nickname: e.sender.nickname,
											user_id: e.user_id,
											content: [
												{
													type: "markdown",
													data: {
														content: forwardNodes
													}
												}
											]
										}
									},
									{
										type: "node",
										data: {
											nickname: e.sender.nickname,
											user_id: e.user_id,
											content: images
										}
									}
								],

								news: [
									{ text: `✅内容含有裸露` },
									{ text: `请确认环境，避免社死` }
								],
								prompt: "718我们一起来吃瓜",
								summary: `By:QQ1638276310`,
								source: `点击查看搜索结果`
							}
						}
					],
					news: [{ text: `✅内容含有裸露` }, { text: `请确认环境，避免社死` }],
					prompt: "718我们一起来吃瓜 ",
					summary: `By:QQ1638276310`,
					source: `点击查看搜索结果`
				}

				// 发送转发消息
				await e.bot.sendApi("send_group_forward_msg", requestBody)
				await page.close()
				await browser.close()
				return
			} catch (error) {
				logger.error(`[吃瓜] 在 ${url} 上出现错误: ${error.message}`)
				lastError = error
				continue
			}
		}

		// 所有URL尝试都失败后
		await browser.close()
		logger.error(`[吃瓜] 所有镜像站点尝试失败: ${lastError?.message}`)
		await this.reply(
			[
				"❌ 获取视频地址失败",
				`错误原因: ${lastError?.message || "未知错误"}`,
				"请检查：",
				"1. 视频ID是否正确",
				"2. 所有镜像站点均无法访问",
				"3. 若持续失败，请联系管理员"
			].join("\n")
		)
	}
}
