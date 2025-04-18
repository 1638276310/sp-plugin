import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import fs from 'fs';
import YAML from 'yaml';
import path from 'path';
import { user, keyValue } from '../config/api.js';

export class ArtistSubscription extends plugin {
    constructor() {
        super({
            name: '画师订阅与推送',
            dsc: '订阅画师并控制P站推送',
            event: 'message.group',
            priority: 50,
            rule: [
                { reg: '^#订阅画师(\\d+)$', fnc: 'subscribeArtist' },
                { reg: '^#取消订阅(\\d+)$', fnc: 'unsubscribeArtist' },
                { reg: '^#订阅列表$', fnc: 'listSubscribedArtists' },
                { reg: '^#开启p推送$', fnc: 'enablePush' },
                { reg: '^#关闭p推送$', fnc: 'disablePush' }
            ]
        });
    }

    ensureDirectoryExistence(filePath) {
        const dirname = path.dirname(filePath);
        if (!fs.existsSync(dirname)) {
            this.ensureDirectoryExistence(dirname);
            fs.mkdirSync(dirname);
        }
    }

    loadData() {
        const filePath = './plugins/kkp-plugin/config/dingyue.yaml';
        if (!fs.existsSync(filePath)) return {};
        const fileContents = fs.readFileSync(filePath, 'utf8');
        return YAML.parse(fileContents) || {};
    }

    saveData(data) {
        const filePath = './plugins/kkp-plugin/config/dingyue.yaml';
        this.ensureDirectoryExistence(filePath);
        const yamlContent = YAML.stringify(data);
        fs.writeFileSync(filePath, yamlContent, 'utf8');
    }

    async subscribeArtist(e) {
        if (!e.isGroup) return;
        await e.reply("正在订阅，请稍等...", false, { at: true, recallMsg: 60 });
        const groupId = e.group_id;
        const data = this.loadData();

        if (!data[groupId]) data[groupId] = { pushEnabled: false, artists: {} };

        if (Object.keys(data).length > 5) {
            await e.reply('已达到群订阅上限！');
            return;
        }

        if (Object.keys(data[groupId].artists).length >= 20) {
            await e.reply('该群已达到画师订阅上限！');
            return;
        }

        const msg = e.msg.trim();
        const matches = msg.match(/^#订阅画师(\d+)$/);
        const artistId = matches ? matches[1] : null;

        if (!artistId) return;

        let artistName;
        try {
            const response = await axios.get(user(artistId));
            if (response.data.error) {
                await e.reply("该画师id不存在");
                return;
            }
            artistName = response.data.body.pickup[0]?.userName || artistId;
        } catch (err) {
            await e.reply("检查画师ID时发生错误，请稍后重试");
            return;
        }

        if (data[groupId].artists[artistId]) {
            await e.reply(`已经订阅了${artistId}`);
            return;
        }

        data[groupId].artists[artistId] = artistName;
        this.saveData(data);

        await e.reply(`成功订阅画师${artistId}（${artistName}）`);
    }

    async unsubscribeArtist(e) {
        if (!e.isGroup) return;

        const groupId = e.group_id;
        const data = this.loadData();

        if (!data[groupId]) return;

        const msg = e.msg.trim();
        const matches = msg.match(/^#取消订阅(\d+)$/);
        const artistId = matches ? matches[1] : null;
        
        if (!artistId) return;

        if (!data[groupId].artists[artistId]) {
            await e.reply(`还未订阅${artistId}哦`);
            return;
        }

        delete data[groupId].artists[artistId];
        this.saveData(data);

        await e.reply(`成功取消订阅${artistId}`);
    }

    async listSubscribedArtists(e) {
        if (!e.isGroup) return;

        const groupId = e.group_id;
        const data = this.loadData();

        if (!data[groupId] || Object.keys(data[groupId].artists).length === 0) {
            await e.reply("当前没有订阅任何画师");
            return;
        }

        let response = "订阅列表：\n";
        for (const [artistId, artistName] of Object.entries(data[groupId].artists)) {
            response += `${artistName}  ${artistId}\n`;
        }

        await e.reply(response);
    }

    async enablePush(e) {
        const groupId = e.group_id;

        let data = this.loadData();
        if (!data[groupId]) data[groupId] = { pushEnabled: false, artists: {} };

        if (!data[groupId].pushEnabled) {
            data[groupId].pushEnabled = true;
            this.saveData(data);
            await e.reply('已开启p推送。');
        } else {
            await e.reply('已经开启了p推送。');
        }
    }

    async disablePush(e) {
        const groupId = e.group_id;

        let data = this.loadData();
        if (!data[groupId]) return;

        if (data[groupId].pushEnabled) {
            data[groupId].pushEnabled = false;
            this.saveData(data);
            await e.reply('已关闭p推送。');
        } else {
            await e.reply('尚未开启p推送，无需关闭。');
        }
    }
}

