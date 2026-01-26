import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * CosImageFetcher类
 * 处理2图和3图功能，从指定API获取图片并发送
 * 已适配NapCat.Onebot的特殊转发格式
 * @class CosImageFetcher
 * @extends plugin
 */
export class CosImageFetcher extends plugin {
    /**
     * 构造函数
     * 初始化插件名称、描述、事件、优先级和规则
     * @constructor
     */
    constructor() {
        super({
            name: "23图",
            dsc: "23图",
            event: "message",
            priority: 60,
            rule: [
                {
                    reg: "^#?2图$",
                    fnc: "process2Images",
                },
                {
                    reg: "^#?3图$",
                    fnc: "process3Images",
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
     * 获取图片
     * 从指定URL下载图片
     * @async
     * @param {string} url - 图片URL
     * @returns {Promise<Buffer|null>} 图片Buffer或null
     */
    async fetchImage(url) {
        try {
            const response = await axios.get(url, {
                responseType: "arraybuffer",
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            return Buffer.from(response.data, "binary");
        } catch (error) {
            console.error(`Error fetching image: ${error}`);
            return null;
        }
    }

    /**
     * 使用Python处理图片
     * 调用sharp-pixel模块处理图片
     * @async
     * @param {Buffer} imageBuffer - 原始图片Buffer
     * @param {string} imageName - 图片名称
     * @returns {Promise<Buffer>} 处理后的图片Buffer
     */
    async modifyImageWithPython(imageBuffer, imageName) {
        const tempImagePath = `./plugins/sp-plugin/temp/temp_${imageName}.jpg`;
        fs.writeFileSync(tempImagePath, imageBuffer);
        try {
            const modifiedImagePath = await modifyImageSharp(tempImagePath);
            const modifiedImageBuffer = fs.readFileSync(modifiedImagePath);
            fs.unlinkSync(tempImagePath);
            fs.unlinkSync(modifiedImagePath);
            return modifiedImageBuffer;
        } catch (error) {
            fs.unlinkSync(tempImagePath);
            throw error;
        }
    }

    /**
     * 处理2图请求
     * 获取并发送2图（二次元图片）
     * @async
     * @param {Object} e - 事件对象
     * @returns {Promise<void>}
     */
    async process2Images(e) {
        const url = `https://img.mengxix.top/?category=acg`;
        await this.sendImages(e, url, "二次元图片");
    }

    /**
     * 处理3图请求
     * 获取并发送3图（现实图片）
     * @async
     * @param {Object} e - 事件对象
     * @returns {Promise<void>}
     */
    async process3Images(e) {
        const url = `https://img.mengxix.top/?category=reality`;
        await this.sendImages(e, url, "现实图片");
    }

    /**
     * 发送图片
     * 获取、处理并发送图片的核心函数
     * 已适配NapCat.Onebot的特殊转发格式
     * @async
     * @param {Object} e - 事件对象
     * @param {string} url - API URL
     * @param {string} typeName - 图片类型名称
     * @returns {Promise<void>}
     */
    async sendImages(e, url, typeName) {
        // 发送等待提示
        await e.reply(`正在获取${typeName}，请稍等...`, false, { at: true, recallMsg: 60 });

        let promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(this.fetchImage(url));
        }

        try {
            let imageBuffers = await Promise.all(promises);
            let modifiedImagesPromises = imageBuffers
                .filter(Boolean)
                .map((imageBuffer, index) =>
                    this.modifyImageWithPython(imageBuffer, `${typeName}_${index}`)
                );

            let modifiedImages = await Promise.all(modifiedImagesPromises);

            // 检查是否获取到图片
            if (modifiedImages.length === 0) {
                await e.reply("未能获取到图片，请稍后再试。");
                return;
            }

            logger.info(`成功获取并处理了 ${modifiedImages.length} 张${typeName}`);

            // 处理NapCat.Onebot的特殊转发格式
            if (e.bot?.version?.app_name === "NapCat.Onebot") {
                // 为每张图片创建一个消息节点
                const nodes = modifiedImages.map((modifiedImage, index) => {
                    const base64Image = modifiedImage.toString("base64");

                    return {
                        type: "node",
                        data: {
                            nickname: e.user_id.toString(),
                            user_id: e.user_id,
                            content: [
                                {
                                    type: "image",
                                    data: {
                                        file: `base64://${base64Image}`
                                    }
                                }
                            ]
                        }
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
                    source: "QQ/VX：1638276310"
                };

                try {
                    // 根据消息类型发送
                    if (e.isGroup) {
                        await e.bot.sendApi("send_group_forward_msg", requestBody);
                    } else {
                        await e.bot.sendApi("send_private_forward_msg", requestBody);
                    }

                    // 处理撤回逻辑
                    const recallConfig = this.getRecallConfig();
                    if (recallConfig.recall) {
                        // 注意：NapCat转发消息无法撤回，这里我们只能给个提示
                        setTimeout(async () => {
                            await e.reply(`[系统提示] ${typeName}转发消息已到达撤回时间，但NapCat转发消息无法撤回，请自行忽略。`);
                        }, recallConfig.time);
                    }
                } catch (error) {
                    logger.error("NapCat转发消息失败:", error);
                    // 失败时尝试使用普通方式发送第一张图片
                    if (modifiedImages.length > 0) {
                        await e.reply(segment.image(`base64://${modifiedImages[0].toString("base64")}`));
                    } else {
                        await e.reply("消息发送失败，请稍后再试");
                    }
                }
            } else {
                // 标准转发消息处理
                // 为每张图片创建一个消息对象
                const msgList = modifiedImages.map((modifiedImage, index) => ({
                    message: [
                        segment.image(`base64://${modifiedImage.toString("base64")}`)
                    ],
                    nickname: e.user_id.toString(),
                    user_id: e.user_id,
                }));

                try {
                    const forwardMsg = e.isGroup
                        ? await e.group.makeForwardMsg(msgList)
                        : await e.friend.makeForwardMsg(msgList);

                    const recallConfig = this.getRecallConfig();
                    const sentMessage = await e.reply(forwardMsg);

                    if (recallConfig.recall) {
                        setTimeout(() => {
                            e.isGroup
                                ? e.group.recallMsg(sentMessage.message_id)
                                : e.friend.recallMsg(sentMessage.message_id);
                        }, recallConfig.time);
                    }
                } catch (error) {
                    logger.error("创建转发消息失败:", error);
                    // 失败时尝试使用普通方式发送第一张图片
                    if (modifiedImages.length > 0) {
                        await e.reply(segment.image(`base64://${modifiedImages[0].toString("base64")}`));
                    } else {
                        await e.reply("消息发送失败，请稍后再试");
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing images: ${error}`);
            await e.reply(`获取${typeName}时发生错误：${error.toString()}`);
        }
    }
}