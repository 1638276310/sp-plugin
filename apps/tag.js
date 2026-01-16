import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import https from "https";
import { pid, tag as fetchTag } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * SetuImageFetcher类
 * 通过tag搜索Pixiv图片并发送
 * @class SetuImageFetcher
 * @extends plugin
 */
export class SetuImageFetcher extends plugin {
    /**
     * 构造函数
     * 初始化插件名称、描述、事件、优先级和规则
     * @constructor
     */
    constructor() {
        super({
            name: "Setu Image Fetch",
            dsc: "通过tag搜索图",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#?来(\\d+)张(.*?)图$",
                    fnc: "_processSetuImages",
                },
            ],
        });
    }

    /**
     * 获取撤回配置
     * 从recall.yaml配置文件中读取撤回设置
     * @returns {Object} 撤回配置对象
     */
    getRecallConfig() {
        const path = "./plugins/sp-plugin/config/recall.yaml";
        const fileContents = fs.readFileSync(path, "utf8");
        return YAML.parse(fileContents);
    }

    /**
     * 获取Pixiv图片详情
     * 通过PID获取图片的详细信息
     * @async
     * @param {string|number} pidValue - Pixiv图片ID
     * @returns {Promise<Object|null>} 图片详情数据或null
     */
    async fetchPixivImageDetails(pidValue) {
        const apiUrl = pid(pidValue);
        try {
            // 添加忽略SSL证书验证的配置
            const response = await axios.get(apiUrl, {
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            });
            return response.data;
        } catch (error) {
            // 如果HTTPS失败，尝试使用HTTP
            try {
                const httpUrl = apiUrl.replace('https://', 'http://');
                const response = await axios.get(httpUrl);
                return response.data;
            } catch (httpError) {
                console.error("HTTP请求也失败:", httpError.message);
                return null;
            }
        }
    }

    /**
     * 获取标签搜索结果
     * 通过tag搜索Pixiv图片
     * @async
     * @param {string} tagValue - 搜索标签
     * @returns {Promise<Array>} 图片ID数组
     */
    async fetchTagSearchResults(tagValue) {
        const config = this.getRecallConfig();
        const mode = config.mode || "all";
        const order = config.order || "popular_d";
        const apiUrl = `${fetchTag(tagValue)}&mode=${mode}&order=${order}`;

        try {
            // 添加忽略SSL证书验证的配置
            const response = await axios.get(apiUrl, {
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            });
            return response.data.body.data.map((item) => item.id);
        } catch (error) {
            // 如果HTTPS失败，尝试使用HTTP
            const httpUrl = apiUrl.replace('https://', 'http://');
            try {
                const response = await axios.get(httpUrl);
                return response.data.body.data.map((item) => item.id);
            } catch (httpError) {
                console.error("Tag搜索HTTP请求也失败:", httpError.message);
                return [];
            }
        }
    }

    /**
     * 随机获取指定数量的ID
     * 从ID数组中随机选择指定数量的ID
     * @param {Array} ids - ID数组
     * @param {number} count - 需要获取的数量
     * @returns {Array} 随机选择的ID数组
     */
    getRandomIds(ids, count) {
        const shuffled = ids.sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    /**
     * 处理色图图片请求
     * 主处理函数，根据tag和数量获取并发送图片
     * @async
     * @param {Object} e - 事件对象
     * @returns {Promise<void>}
     */
    async _processSetuImages(e) {
        const [, numStr, tag] = e.msg.match(
            this.rule.find((rule) => e.msg.match(rule.reg)).reg
        );
        const num = parseInt(numStr);

        if (num > 20) {
            await e.reply("你想冲死吗？");
            return;
        }

        const idsList = await this.fetchTagSearchResults(tag);
        if (!idsList || idsList.length === 0) {
            await e.reply("没有这种图啊，涩批！");
            return;
        }

        const selectedPids = this.getRandomIds(idsList, num);
        const detailsPromises = selectedPids.map((pid) =>
            this.fetchPixivImageDetails(pid)
        );
        const detailsList = await Promise.all(detailsPromises);
        await e.reply("图片获取完毕，正在发送中...", false, {
            at: true,
            recallMsg: 60,
        });

        const imageMessages = await Promise.all(
            detailsList.map(async (details, index) => {
                if (details && details.body) {
                    const imageUrls = Object.values(details.body.urls).map(
                        (url) => `${url}`
                    );
                    const tagList = details.body.tags.tags.map((tagObj) => tagObj.tag);

                    const imageDatas = await Promise.all(
                        imageUrls.map(async (imageUrl) => {
                            try {
                                // 图片下载也添加SSL忽略
                                const imageDataResponse = await axios.get(imageUrl, {
                                    responseType: "arraybuffer",
                                    maxContentLength: Infinity,
                                    maxBodyLength: Infinity,
                                    httpsAgent: new https.Agent({
                                        rejectUnauthorized: false
                                    })
                                });
                                return imageDataResponse.data;
                            } catch (error) {
                                // 图片下载也尝试HTTP回退
                                try {
                                    const httpUrl = imageUrl.replace('https://', 'http://');
                                    const imageDataResponse = await axios.get(httpUrl, {
                                        responseType: "arraybuffer",
                                        maxContentLength: Infinity,
                                        maxBodyLength: Infinity,
                                    });
                                    return imageDataResponse.data;
                                } catch (httpError) {
                                    console.error(`图片下载失败: ${imageUrl}`, httpError.message);
                                    return null;
                                }
                            }
                        })
                    );

                    const validImageDatas = imageDatas.filter((data) => data !== null);

                    const modifiedImagePaths = await Promise.all(
                        validImageDatas.map(async (imageData, i) => {
                            const imagePath = `./plugins/sp-plugin/temp/temp_image_${index}_${i}.jpg`;
                            fs.writeFileSync(imagePath, imageData);
                            const modifiedImagePath = await modifyImageSharp(imagePath);
                            return modifiedImagePath;
                        })
                    );

                    const msgData = [
                        `id：${details.body.illustId}\n`,
                        `画师：${details.body.userName}（${details.body.userId}）\n`,
                        `是否ai：${details.body.aiType === 2 ? "是" : "否"}\n`,
                        `标题：${details.body.illustTitle}\n`,
                        `上传时间：${details.body.createDate}\n`,
                        `♥：${details.body.likeCount}\n`,
                        `😊：${details.body.bookmarkCount}\n`,
                        `👁：${details.body.viewCount}\n`,
                        `tag：${tagList.join(", ")}\n`,
                        ...modifiedImagePaths.map((imagePath) => segment.image(imagePath)),
                    ];

                    return {
                        message: msgData,
                        nickname: e.user_id.toString(),
                        user_id: e.user_id,
                    };
                }
                return null;
            })
        );

        const validImageMessages = imageMessages.filter((msg) => msg !== null);

        if (validImageMessages.length > 0) {
            const recallConfig = this.getRecallConfig();

            // 按10个消息一组进行分组
            const groupSize = 10;
            const messageGroups = [];

            // 将消息分组，每组最多10个
            for (let i = 0; i < validImageMessages.length; i += groupSize) {
                const group = validImageMessages.slice(i, i + groupSize);
                messageGroups.push(group);
            }

            // 发送每组转发消息
            for (let i = 0; i < messageGroups.length; i++) {
                const group = messageGroups[i];

                // 构建转发消息
                const forwardMsg = e.isGroup
                    ? await e.group.makeForwardMsg(group)
                    : await e.friend.makeForwardMsg(group);

                // 发送转发消息
                const sentMessage = await e.reply(forwardMsg);

                // 设置撤回
                if (recallConfig.recall) {
                    setTimeout(() => {
                        e.isGroup
                            ? e.group.recallMsg(sentMessage.message_id)
                            : e.friend.recallMsg(sentMessage.message_id);
                    }, recallConfig.time);
                }

                // 如果有多组，等待一段时间再发送下一组（避免发送过快）
                if (i < messageGroups.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    }
}