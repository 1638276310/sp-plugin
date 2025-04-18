import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import { user } from '../config/api.js';

export class ArtistDetails extends plugin {
    constructor() {
        super({
            name: '获取画师作品id',
            dsc: '获取画师作品id',
            event: 'message',
            priority: '500',
            rule: [
                {
                    reg: '^#画师(\\d+)$', 
                    fnc: 'processArtist'
                }
            ]
        });
    }

    async fetchArtistDetails(artistId) {
        try {
            const response = await axios.get(user(artistId));  
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 403) {
                throw new Error("暂无权使用");
            }
            console.error(`Error fetching artist details: ${error.message}`);
            return null;
        }
    }

    async processArtist(e) {
        if (!e.isGroup) return;
        await e.reply("正在搜索，请稍等...", false, { at: true, recallMsg: 60 });

        try {
            const match = e.msg.match(/^#画师(\d+)$/);
            if (!match) return;

            const artistId = match[1];
            const artistData = await this.fetchArtistDetails(artistId);

            if (!artistData || artistData.error) {
                await e.reply('请输入正确的画师id');
                return;
            }

            let allMessages = [];
            allMessages.push({
                user_id: e.user_id,
                nickname: e.user_id.toString(),
                message: `画师：${artistData.body.pickup[0].userName}（${artistId}）`
            });

            const workIDs = Object.keys(artistData.body.illusts).reverse();

            for (let i = 0; i < Math.min(workIDs.length, 99); i++) {
                allMessages.push({
                    user_id: e.user_id,
                    nickname: e.user_id.toString(),
                    message: workIDs[i]  
                });
            }

            const forwardMsg = await e.group.makeForwardMsg(allMessages);
            await e.reply(forwardMsg);
        } catch (error) {
            if (error.message === "暂无权使用") {
                await e.reply("暂无权使用");
            }
        }
    }
}
