import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import { pid, user } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * Pixiv画师作品获取插件
 * @class PixivArtistWorksFetcher
 * @classdesc 通过画师ID随机获取作品图片的插件
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 */
export class PixivArtistWorksFetcher extends plugin {
    /**
     * 插件构造函数
     * @constructs PixivArtistWorksFetcher
     */
    constructor() {
        super({
            name: "p站画师id获取图片",
            dsc: "通过画师ID获取作品图片",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#?随机(\\d+)张(\\d+)作品$",
                    fnc: "processRandomArtistWorks",
                },
            ],
        });
    }

    /**
     * 获取撤回配置文件
     * @returns {Object} 撤回配置对象
     */
    getRecallConfig() {
        const path = "./plugins/sp-plugin/config/recall.yaml";
        const fileContents = fs.readFileSync(path, "utf8");
        return YAML.parse(fileContents);
    }

    /**
     * 获取画师详情
     * @async
     * @param {string} artistId - 画师ID
     * @returns {Promise<Object>} 画师详细信息
     * @throws {Error} 请求失败时抛出错误
     */
    async fetchArtistDetails(artistId) {
        try {
            const response = await axios.get(user(artistId));
            return response.data;
        } catch (error) {
            throw new Error(`获取画师信息失败：${error.message}`);
        }
    }

    /**
     * 获取作品详情
     * @async
     * @param {string} pidValue - 作品ID
     * @returns {Promise<Object>} 作品详细信息
     * @throws {Error} 请求失败时抛出错误
     */
    async fetchWorkDetails(pidValue) {
        try {
            const response = await axios.get(pid(pidValue));
            return response.data;
        } catch (error) {
            throw new Error(`获取作品信息失败：${error.message}`);
        }
    }

    /**
     * 使用Python处理图片（通过sharp-pixel模块）
     * @async
     * @param {Buffer} imageBuffer - 原始图片缓冲区
     * @param {string} imageName - 图片名称
     * @returns {Promise<Buffer>} 处理后的图片缓冲区
     * @throws {Error} 处理失败时抛出错误
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
     * 处理随机画师作品请求
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<void>}
     */
    async processRandomArtistWorks(e) {
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });

        const match = e.msg.match(/^#?随机(\d+)张(\d+)作品$/);
        if (!match) return;

        const num = parseInt(match[1]);
        const artistId = match[2];

        if (num > 20) {
            await e.reply("一次最多看20张哦");
            return;
        }

        try {
            const artistData = await this.fetchArtistDetails(artistId);
            if (!artistData || artistData.error) {
                await e.reply("请输入正确的画师ID");
                return;
            }

            const allWorkIDs = Object.keys(artistData.body.illusts);
            const workIDs = this.shuffleArray(allWorkIDs).slice(0, num);

            const workDetailsPromises = workIDs.map((workId) =>
                this.fetchWorkDetails(workId)
            );
            const workDetailsList = await Promise.all(workDetailsPromises);
            await this.sendCombinedWorkDetails(e, workDetailsList);
        } catch (error) {
            await e.reply(`发生错误：${error.toString()}`);
        }
    }

    /**
     * 发送合并的作品详情
     * @async
     * @param {Object} e - 消息事件对象
     * @param {Array<Object>} workDetailsList - 作品详情列表
     * @returns {Promise<void>}
     */
    async sendCombinedWorkDetails(e, workDetailsList) {
        const combinedMsgData = [];

        const imageDataTasks = workDetailsList.map(async (details, index) => {
            const body = details.body;
            const imageUrls = Object.values(body.urls);
            const tagList = body.tags.tags.map((tagObj) => tagObj.tag);

            const msgData = [
                `id：${body.illustId}\n`,
                `画师：${body.userName}（${body.userId}）\n`,
                `是否ai：${body.aiType === 2 ? "是" : "否"}\n`,
                `标题：${body.illustTitle}\n`,
                `上传时间：${body.createDate}\n`,
                `♥：${body.likeCount}\n`,
                `😊：${body.bookmarkCount}\n`,
                `👁：${body.viewCount}\n`,
                `tag：${tagList.join(", ")}\n`,
            ].join("");

            const imageBuffers = await Promise.all(
                imageUrls.map(async (imageUrl, i) => {
                    const response = await axios.get(imageUrl, {
                        responseType: "arraybuffer",
                    });
                    return this.modifyImageWithPython(
                        response.data,
                        `image_${index}_${i}`
                    );
                })
            );

            return { msgData, imageBuffers };
        });

        const resolvedTasks = await Promise.all(imageDataTasks);

        for (const { msgData, imageBuffers } of resolvedTasks) {
            combinedMsgData.push({
                message: [
                    msgData,
                    ...imageBuffers.map((buffer) => segment.image(buffer)),
                ],
                forward: true,
            });
        }

        const forwardMsg = e.isGroup
            ? await e.group.makeForwardMsg(combinedMsgData)
            : await e.friend.makeForwardMsg(combinedMsgData);

        const recallConfig = this.getRecallConfig();
        const sentMessage = await e.reply(forwardMsg);

        if (recallConfig.recall) {
            setTimeout(() => {
                e.isGroup
                    ? e.group.recallMsg(sentMessage.message_id)
                    : e.friend.recallMsg(sentMessage.message_id);
            }, recallConfig.time);
        }
    }

    /**
     * 随机打乱数组顺序
     * @param {Array} array - 需要打乱顺序的数组
     * @returns {Array} 打乱顺序后的数组
     */
    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}