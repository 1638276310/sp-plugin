import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import https from "https";
import { pid, tag as fetchTag } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

const sp_plugin_path = process.cwd() + "/plugins/sp-plugin/";

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
            name: "通过tag搜索图片",
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
        const recall_path = sp_plugin_path + "config/recall.yaml";
        const fileContents = fs.readFileSync(recall_path, "utf8");
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
            const response = await axios.get(apiUrl, {
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            });
            return response.data;
        } catch (error) {
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
            const response = await axios.get(apiUrl, {
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            });
            return response.data.body.data.map((item) => item.id);
        } catch (error) {
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
     * 处理单个图片的下载和处理
     * @async
     * @param {string} imageUrl - 图片URL
     * @param {number} index - 图片索引
     * @param {number} subIndex - 子图片索引
     * @returns {Promise<Object|null>} 处理后的图片信息
     */
    async processSingleImage(imageUrl, index, subIndex) {
        try {
            const imageDataResponse = await axios.get(imageUrl, {
                responseType: "arraybuffer",
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            });

            const imagePath = sp_plugin_path + `temp/temp_image_${index}_${subIndex}.jpg`;
            fs.writeFileSync(imagePath, imageDataResponse.data);

            const modifiedImagePath = await modifyImageSharp(imagePath);

            return { path: modifiedImagePath, url: imageUrl };
        } catch (error) {
            try {
                const httpUrl = imageUrl.replace('https://', 'http://');
                const imageDataResponse = await axios.get(httpUrl, {
                    responseType: "arraybuffer",
                    maxContentLength: Infinity,
                    maxBodyLength: Infinity,
                });

                const imagePath = sp_plugin_path + `temp/temp_image_${index}_${subIndex}.jpg`;
                fs.writeFileSync(imagePath, imageDataResponse.data);

                const modifiedImagePath = await modifyImageSharp(imagePath);

                return { path: modifiedImagePath, url: imageUrl };
            } catch (httpError) {
                console.error(`图片下载失败: ${imageUrl}`, httpError.message);
                return null;
            }
        }
    }

    /**
     * 处理PID的所有图片
     * @async
     * @param {Object} details - 图片详情
     * @param {number} index - 索引
     * @param {Object} e - 事件对象
     * @returns {Promise<Object|null>} 消息数据
     */
    async processPidImages(details, index, e) {
        if (!details || !details.body) return null;

        const imageUrls = Object.values(details.body.urls).map((url) => `${url}`);
        const tagList = details.body.tags.tags.map((tagObj) => tagObj.tag);

        // 限制单张PID的图片数量，最多处理3张
        const maxImagesPerPid = 5;
        const urlsToProcess = imageUrls.slice(0, maxImagesPerPid);

        // 串行处理图片，最多同时处理2张
        const modifiedImagePaths = [];
        for (let i = 0; i < urlsToProcess.length; i++) {
            const result = await this.processSingleImage(urlsToProcess[i], index, i);
            if (result) {
                modifiedImagePaths.push(result);
            }

            // 如果还有下一张图片，等待一小段时间再处理
            if (i < urlsToProcess.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        if (modifiedImagePaths.length === 0) return null;

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
        ];

        // 添加图片和URL
        modifiedImagePaths.forEach((item, i) => {
            msgData.push(segment.image(item.path));
            msgData.push(`图片${i + 1} URL：${item.url}\n`);
        });

        return {
            message: msgData,
            nickname: e.user_id.toString(),
            user_id: e.user_id,
        };
    }

    /**
     * 处理一组PID（最多10个）
     * @async
     * @param {Array} pids - PID数组
     * @param {Object} e - 事件对象
     * @param {number} groupIndex - 组索引
     * @returns {Promise<Array>} 消息数组
     */
    async processPidGroup(pids, e, groupIndex) {
        const messages = [];

        // 串行处理每个PID，最多同时处理2个PID
        for (let i = 0; i < pids.length; i++) {
            const pidValue = pids[i];
            const details = await this.fetchPixivImageDetails(pidValue);

            if (details) {
                const msg = await this.processPidImages(details, groupIndex * 10 + i, e);
                if (msg) {
                    messages.push(msg);
                }
            }

            // 如果还有下一个PID，等待一小段时间再处理
            if (i < pids.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return messages;
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

        if (num > 60) {
            await e.reply("你想冲死吗？");
            return;
        }

        const idsList = await this.fetchTagSearchResults(tag);
        if (!idsList || idsList.length === 0) {
            await e.reply("没有这种图啊，涩批！");
            return;
        }

        const selectedPids = this.getRandomIds(idsList, num);

        // 清理临时文件夹
        try {
            const tempDir = sp_plugin_path + "temp/";
            if (fs.existsSync(tempDir)) {
                const files = fs.readdirSync(tempDir);
                for (const file of files) {
                    if (file.startsWith("temp_image_")) {
                        fs.unlinkSync(tempDir + file);
                    }
                }
            }
        } catch (cleanError) {
            console.error("清理临时文件失败:", cleanError.message);
        }

        await e.reply(`找到${selectedPids.length}张图片，开始处理...`, false, {
            at: true,
            recallMsg: 10,
        });

        // 按10个一组分组处理
        const groupSize = 10;
        const recallConfig = this.getRecallConfig();

        for (let groupIndex = 0; groupIndex < selectedPids.length; groupIndex += groupSize) {
            const endIndex = Math.min(groupIndex + groupSize, selectedPids.length);
            const groupPids = selectedPids.slice(groupIndex, endIndex);

            console.log(`处理第${Math.floor(groupIndex / groupSize) + 1}组，共${groupPids.length}个PID`);

            const groupMessages = await this.processPidGroup(groupPids, e, Math.floor(groupIndex / groupSize));

            if (groupMessages.length > 0) {
                // 处理NapCat.Onebot的特殊转发格式
                if (e.bot?.version?.app_name === "NapCat.Onebot") {
                    const nodes = groupMessages.map((msg) => {
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
                                // 安全获取图片URL
                                const fileUrl = item.data?.file || item.data?.url || item.file || "";
                                if (fileUrl) {
                                    content.push({
                                        type: "image",
                                        data: { file: fileUrl },
                                    });
                                } else {
                                    console.error("图片URL解析失败:", item);
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

                    // 构建请求体 - 添加固定信息
                    const requestBody = {
                        group_id: e.group_id,
                        user_id: e.user_id,
                        messages: nodes,
                        news: [{ text: "QQ/VX：1638276310" }],
                        prompt: "QQ/VX：1638276310",
                        summary: "QQ/VX：1638276310",
                        source: "QQ/VX：1638276310",
                    };

                    try {
                        // 根据消息类型发送
                        if (e.isGroup) {
                            await e.bot.sendApi("send_group_forward_msg", requestBody);
                        } else {
                            await e.bot.sendApi("send_private_forward_msg", requestBody);
                        }
                    } catch (error) {
                        console.error("NapCat转发消息失败:", error);
                        await e.reply("消息发送失败，请稍后再试", true);
                    }
                } else {
                    // 标准转发消息处理
                    const forwardMsg = e.isGroup
                        ? await e.group.makeForwardMsg(groupMessages)
                        : await e.friend.makeForwardMsg(groupMessages);

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
                }

                // 如果不是最后一组，等待一段时间再处理下一组
                if (endIndex < selectedPids.length) {
                    await e.reply(`正在处理下一组图片...`, false, {
                        recallMsg: 5,
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        await e.reply("所有图片发送完毕！", false, {
            at: true,
            recallMsg: 10,
        });
    }
}