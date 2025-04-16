import fetch from 'node-fetch';
import plugin from '../../../lib/plugins/plugin.js';

export class LanzouParser extends plugin {
    constructor() {
        super({
            name: '蓝奏云链接解析',
            dsc: '解析蓝奏云链接并获取下载信息',
            event: 'message',
            priority: 500,
            rule: [
                {
                    reg: '^#?蓝奏云解析(.*)$',
                    fnc: 'parseLanzouLink'
                },
                {
                    reg: '^#?蓝解析帮助$',
                    fnc: 'parseLanzouLinkHelp' 
                }
            ]
        });
    }

    async parseLanzouLinkHelp(e) {
        const helpMessage = `
        蓝奏云链接解析插件使用说明：

        1. 命令格式：
           #蓝奏云解析 <链接> <密码（可选）>

        2. 示例：  

           #蓝奏云解析 URL 密码           #蓝奏云解析 https://www.lanzous.com/i5347629 123456`;
        await e.reply(helpMessage);
    }
    async parseLanzouLink(e) {
        try {
            const matches = e.msg.match(/^#蓝奏云解析 (.*)$/);
            const params = matches[1].split(' ');
            const url = params[0];
            const pwd = params[1];
            const apiUrl = `https://api.kxzjoker.cn/api/lanzou?url=${encodeURIComponent(url)}&pwd=${encodeURIComponent(pwd)}`;
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.code === 200) {
                const msg = `解析成功！\n文件名称：${data.name}\n文件大小：${data.filesize}\n下载链接：${data.downUrl}`;
                const messageContent = [msg];
                const dec = '点我查看蓝奏云解析内容';
                let forwardMsg = await this.makeForwardMsg(e, messageContent, dec);
                await e.reply(forwardMsg, false, { recallMsg: 100 });
            } else {
                await e.reply(`解析失败，错误信息：${data.msg}`);
            }
        } catch (error) {
            await e.reply(`请求发生错误：${error.message}`);
        }
    }

    async makeForwardMsg(e, msg = [], dec = '') {
        let userInfo = {
            nickname: e.sender.nickname,
            user_id: e.user_id
        };

        let forwardMsg = [];
        msg.forEach(v => {
            forwardMsg.push({
                ...userInfo,
                message: v
            });
        });

        if (e.isGroup) {
            forwardMsg = await e.group.makeForwardMsg(forwardMsg);
        } else if (e.friend) {
            forwardMsg = await e.friend.makeForwardMsg(forwardMsg);
        } else {
            return false;
        }

        if (dec) {
            if (typeof (forwardMsg.data) === 'object') {
                let detail = forwardMsg.data?.meta?.detail;
                if (detail) {
                    detail.news = [{ text: dec }];
                }
            } else {
                forwardMsg.data = forwardMsg.data
                   .replace('<?xml version="1.0" encoding="utf-8"?>', '<?xml version="1.0" encoding="utf-8" ?>')
                   .replace(/\n/g, '')
                   .replace(/<title color="#777777" size="26">(.+?)<\/title>/g, '___')
                   .replace(/___+/, `<title color="#777777" size="26">${dec}</title>`);
            }
        }
        return forwardMsg;
    }
}