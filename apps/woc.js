import lodash from "lodash";

// 默认配置
const DEFAULT_CONFIG = {
    apiUrl: "https://yingtall.com/wp-json/wp/v2/posts?page=",
    imageLimit: 5,
    cdTime: 60,
    forwardAsBot: false,
    deleteMsg: 30,
};

/**
 * WocPlugin类
 * 神秘指令图片获取插件，通过关键字触发获取图片
 * @class WocPlugin
 * @extends plugin
 */
export class WocPlugin extends plugin {
    /**
     * 构造函数
     * 初始化插件名称、描述、事件、优先级和规则
     * @constructor
     */
    constructor() {
        super({
            name: "wocpp",
            dsc: "PP版神秘指令图片获取",
            event: "message",
            priority: -Infinity,
            rule: [
                {
                    reg: "^#?woc|wc|卧槽|我曹|我草|我操|我艹|窝草|卧草|我擦",
                    fnc: "wocHandler",
                    permission: "all",
                },
            ],
        });

        // 使用默认配置
        this.config = DEFAULT_CONFIG;
    }

    /**
     * woc指令处理器
     * 处理用户输入的woc相关指令，检查冷却时间并执行主逻辑
     * @async
     * @returns {Promise<boolean>} 处理是否成功
     */
    async wocHandler(e) {
        const currentGroup = Number(this.e.group_id);

        const cdKey = `Yz:woc:${currentGroup}`;
        const remainingCD = await this.getRemainingCD(cdKey);

        if (remainingCD > 0) {
            const cdMsg = this.formatCDMessage(remainingCD);
            this.e.reply(`指令冷却中，剩余时间：${cdMsg}`, true);
            return false;
        }

        redis.set(cdKey, "1", { EX: this.config.cdTime });

        await this.executeMainLogic();
    }

    /**
     * 获取剩余冷却时间
     * 从Redis中查询指定key的剩余生存时间
     * @async
     * @param {string} key - Redis键名
     * @returns {Promise<number>} 剩余秒数
     */
    async getRemainingCD(key) {
        try {
            const ttl = await redis.ttl(key);
            return ttl > 0 ? ttl : 0;
        } catch (error) {
            logger.error(`冷却查询失败：${error.message}`);
            return 0;
        }
    }

    /**
     * 格式化冷却时间消息
     * 将秒数转换为"分:秒"格式的字符串
     * @param {number} seconds - 总秒数
     * @returns {string} 格式化后的时间字符串
     */
    formatCDMessage(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}分${secs.toString().padStart(2, "0")}秒`;
    }

    /**
     * 执行主逻辑
     * 从API获取图片并发送
     * @async
     * @returns {Promise<void>}
     */
    async executeMainLogic() {
        await this.e.reply("探索神秘空间中...", true);

        try {
            const randomPage = Math.floor(Math.random() * 50) + 1;
            const response = await fetch(`${this.config.apiUrl}${randomPage}`);

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();

            const images = this.extractImages(data);
            if (!images.length) {
                this.e.reply("没有找到任何图片，换个姿势试试吧~", true);
                return;
            }

            const sendImages = lodash.sampleSize(images, this.config.imageLimit);
            await this.sendImages(sendImages);
        } catch (err) {
            logger.error(`操作失败：${err.message}`);
            this.e.reply("连接神秘空间失败，请稍后再试", true);
        }
    }

    /**
     * 提取图片URL
     * 从API响应数据中提取所有图片URL
     * @param {Object} data - API响应数据
     * @returns {Array<string>} 图片URL数组
     */
    extractImages(data) {
        try {
            const content = lodash.get(data, "[0].content.rendered", "");
            const imgTags = content.match(/<img.*?src="(.*?)"/g) || [];
            return imgTags
                .map((img) => img.replace(/.*src="([^"]+).*/, "$1"))
                .filter((url) => url.startsWith("http"));
        } catch (error) {
            logger.error(`图片解析失败：${error.message}`);
            return [];
        }
    }

    /**
     * 发送图片
     * 将图片URL数组转换为转发消息并发送
     * @async
     * @param {Array<string>} images - 图片URL数组
     * @returns {Promise<void>}
     */
    async sendImages(images) {
        try {
            const messages = images.map((url) => ({
                message: segment.image(url),
                nickname: this.config.forwardAsBot
                    ? this.e.bot.nickname
                    : this.e.sender.card,
                user_id: this.config.forwardAsBot ? this.e.bot.uin : this.e.user_id,
            }));

            const forwardMsg = await Bot.makeForwardMsg(messages);
            await this.e.reply(forwardMsg);
        } catch (error) {
            logger.error(`图片发送失败：${error.message}`);
            this.e.reply("图片发送过程中出现错误", true);
        }
    }
}