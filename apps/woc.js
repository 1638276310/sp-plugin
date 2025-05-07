import fetch from "node-fetch";
import lodash from "lodash";

// 默认配置
const DEFAULT_CONFIG = {
    apiUrl: "https://yingtall.com/wp-json/wp/v2/posts?page=", 
    imageLimit: 5,
    cdTime: 60,
    forwardAsBot: false,
    deleteMsg: 30
};

export class WocPlugin extends plugin {
    constructor() {
        super({
            name: "wocpp",
            dsc: "PP版神秘指令图片获取",
            event: "message",
            priority: 500,
            rule: [
                {
                    reg: "^#?(woc|卧槽|我擦|wc)",
                    fnc: "wocHandler",
                    permission: "all"
                }
            ]
        });
        
        // 使用默认配置
        this.config = DEFAULT_CONFIG;
    }

    async wocHandler(e) {
        // if (!this.e.isGroup) {
        //     this.e.reply("[安全限制] 请勿私聊使用本指令", true);
        //     return false;
        // }
        // await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });
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

    async getRemainingCD(key) {
        try {
            const ttl = await redis.ttl(key);
            return ttl > 0 ? ttl : 0;
        } catch (error) {
            console.error(`冷却查询失败：${error.message}`);
            return 0;
        }
    }

    formatCDMessage(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}分${secs.toString().padStart(2, '0')}秒`;
    }

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
            console.error(`操作失败：${err.message}`);
            this.e.reply("连接神秘空间失败，请稍后再试", true);
        }
    }

    extractImages(data) {
        try {
            const content = lodash.get(data, "[0].content.rendered", "");
            const imgTags = content.match(/<img.*?src="(.*?)"/g) || [];
            return imgTags
              .map(img => img.replace(/.*src="([^"]+).*/, "$1"))
              .filter(url => url.startsWith("http"));
        } catch (error) {
            console.error(`图片解析失败：${error.message}`);
            return [];
        }
    }

    async sendImages(images) {
        try {
            const messages = images.map(url => ({
                message: segment.image(url),
                nickname: this.config.forwardAsBot ? this.e.bot.nickname : this.e.sender.card,
                user_id: this.config.forwardAsBot ? this.e.bot.uin : this.e.user_id
            }));

            const forwardMsg = await Bot.makeForwardMsg(messages);
            await this.e.reply(forwardMsg, false, {
                recallMsg: this.config.deleteMsg
            });
        } catch (error) {
            console.error(`图片发送失败：${error.message}`);
            this.e.reply("图片发送过程中出现错误", true);
        }
    }
}



