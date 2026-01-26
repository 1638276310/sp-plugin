import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * CosImageFetcher类
 * 处理2图和3图功能，从指定API获取图片并发送
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
        await this.sendImages(e, url);
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
        await this.sendImages(e, url);
    }

    /**
     * 发送图片
     * 获取、处理并发送图片的核心函数
     * @async
     * @param {Object} e - 事件对象
     * @param {string} url - API URL
     * @returns {Promise<void>}
     */
    async sendImages(e, url) {
        let promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(this.fetchImage(url));
        }

        try {
            let imageBuffers = await Promise.all(promises);
            let modifiedImagesPromises = imageBuffers
                .filter(Boolean)
                .map((imageBuffer, index) =>
                    this.modifyImageWithPython(imageBuffer, `image_${index}`)
                );

            let modifiedImages = await Promise.all(modifiedImagesPromises);

            let msgList = modifiedImages.map((modifiedImage, index) => ({
                message: [
                    `涩批还看 ${index + 1}`,
                    "\n",
                    segment.image(`base64://${modifiedImage.toString("base64")}`),
                ],
                nickname: e.user_id.toString(),
                user_id: e.user_id,
            }));

            if (msgList.length > 0) {
                // NapCat 特殊转发格式处理
                if (e.bot?.version?.app_name === "NapCat.Onebot") {
                    // 构建节点消息
                    const nodes = msgList.map((msg) => {
                        const content = [];

                        // 处理消息数组
                        if (Array.isArray(msg.message)) {
                            for (const item of msg.message) {
                                if (typeof item === "string") {
                                    content.push({
                                        type: "text",
                                        data: { text: item },
                                    });
                                } else if (item?.type === "image") {
                                    // 处理 base64 图片
                                    const fileUrl = item.data?.file || "";
                                    if (fileUrl) {
                                        content.push({
                                            type: "image",
                                            data: { file: fileUrl },
                                        });
                                    }
                                }
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
                        ? await e.group.makeForwardMsg(msgList)
                        : await e.friend.makeForwardMsg(msgList);

                    const sentMessage = await e.reply(forwardMsg);

                    // 撤回逻辑
                    const recallConfig = this.getRecallConfig();
                    if (recallConfig.recall) {
                        setTimeout(() => {
                            e.isGroup
                                ? e.group.recallMsg(sentMessage.message_id)
                                : e.friend.recallMsg(sentMessage.message_id);
                        }, recallConfig.time);
                    }
                }
            } else {
                await e.reply("未能获取到图片，请稍后再试。");
            }
        } catch (error) {
            console.error(`Error processing images: ${error}`);
            await e.reply(`发生错误：${error.toString()}`);
        }
    }
}