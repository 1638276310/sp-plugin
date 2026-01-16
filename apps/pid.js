import axios from "axios";
import fs from "fs";
import YAML from "yaml";
import { pid as pidAPI } from "../config/api.js";
import { modifyImageSharp } from "../lib/sharp-pixel.js";

/**
 * Pixiv图片获取插件
 * @class PixivImageFetcher
 * @classdesc 通过Pixiv作品ID获取图片及相关信息的插件
 * @property {string} name - 插件名称
 * @property {string} dsc - 插件描述
 * @property {string} event - 监听事件
 * @property {number} priority - 优先级
 * @property {Array} rule - 命令规则
 */
export class PixivImageFetcher extends plugin {
    /**
     * 插件构造函数
     * @constructs PixivImageFetcher
     */
    constructor() {
        super({
            name: "获取p站图",
            dsc: "获取p站图",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#?pid(\\d+)$",
                    fnc: "processPixivImages",
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
     * 获取图片详细信息
     * @async
     * @param {string} url - API请求URL
     * @returns {Promise<Object>} 图片详细信息
     * @throws {Error} 请求失败时抛出错误
     */
    async fetchImageDetails(url) {
        try {
            const response = await axios.get(url);
            return response.data;
        } catch (error) {
            throw error;
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
     * 处理Pixiv图片请求
     * @async
     * @param {Object} e - 消息事件对象
     * @returns {Promise<void>}
     */
    async processPixivImages(e) {
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
        try {
            const matchedPid = e.msg.match(/^#?pid(\d+)$/)[1];
            const url = `${pidAPI(matchedPid)}`;
            await this.sendPixivDetails(e, url);
        } catch (error) {
            await e.reply(`发生错误：${error.toString()}`);
        }
    }

    /**
     * 发送Pixiv图片详情
     * @async
     * @param {Object} e - 消息事件对象
     * @param {string} url - API请求URL
     * @returns {Promise<void>}
     * @throws {Error} 请求失败或数据处理失败时抛出错误
     */
    async sendPixivDetails(e, url) {
        const details = await this.fetchImageDetails(url);
        if (!details || !details.body) {
            throw new Error("请输入正确的pid");
        }
        const body = details.body;
        const imageUrls = Object.values(body.urls).map((url) => `${url}`);
        const tagList = body.tags.tags.map((tagObj) => tagObj.tag);

        const imageDataPromises = imageUrls.map(async (imageUrl, index) => {
            const imageDataResponse = await axios.get(imageUrl, {
                responseType: "arraybuffer",
            });
            return this.modifyImageWithPython(
                imageDataResponse.data,
                `image_${index}`
            );
        });

        const modifiedImageBuffers = await Promise.all(imageDataPromises);

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
        ].concat(modifiedImageBuffers.map((buffer) => segment.image(buffer)));

        const msgList = [
            {
                message: msgData,
                nickname: e.user_id.toString(),
                user_id: e.user_id,
            },
        ];

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
    }
}