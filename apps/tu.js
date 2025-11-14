import axios from 'axios';
import fs from 'fs';
import YAML from 'yaml';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';

export class CosImageFetcher extends plugin {
    constructor() {
        super({
            name: '23图',
            dsc: '23图',
            event: 'message',
            priority: 60,
            rule: [
                {
                    reg: '^#?2图$',
                    fnc: 'process2Images'
                },
                {
                    reg: '^#?3图$',
                    fnc: 'process3Images'
                }
            ]
        });
    }

    getRecallConfig() {
        const path = './plugins/sp-plugin/config/recall.yaml';
        const fileContents = fs.readFileSync(path, 'utf8');
        return YAML.parse(fileContents);
    }

    async fetchImage(url) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
            return Buffer.from(response.data, 'binary');
        } catch (error) {
            console.error(`Error fetching image: ${error}`);
            return null;
        }
    }

    async modifyImageWithPython(imageBuffer, imageName) {
        const tempImagePath = `./plugins/sp-plugin/temp/temp_${imageName}.jpg`;

        fs.writeFileSync(tempImagePath, imageBuffer);

        try {
            const { stdout } = await execFileAsync(pythonCommand, ['./plugins/sp-plugin/modify_image.py', tempImagePath]);
            const modifiedImagePath = stdout.trim();
            const modifiedImageBuffer = fs.readFileSync(modifiedImagePath);

            fs.unlinkSync(tempImagePath);
            fs.unlinkSync(modifiedImagePath);

            return modifiedImageBuffer;
        } catch (error) {
            fs.unlinkSync(tempImagePath);
            throw error;
        }
    }

    async process2Images(e) {
        const url = `https://www.mengxix.top/acg/index.php?type=img`;
        await this.sendImages(e, url);
    }

    async process3Images(e) {
        const url = `https://www.mengxix.top/reality/index.php?type=img`;
        await this.sendImages(e, url);
    }

    async sendImages(e, url) {
        let promises = [];
        for (let i = 0; i < 10; i++) {
            promises.push(this.fetchImage(url));
        }

        try {
            let imageBuffers = await Promise.all(promises);

            let modifiedImagesPromises = imageBuffers.filter(Boolean).map((imageBuffer, index) => 
                this.modifyImageWithPython(imageBuffer, `image_${index}`)
            );

            let modifiedImages = await Promise.all(modifiedImagesPromises);

            let msgList = modifiedImages.map((modifiedImage, index) => ({
                message: [`涩批还看 ${index + 1}`, "\n", segment.image(`base64://${modifiedImage.toString('base64')}`)],
                nickname: e.user_id.toString(),
                user_id: e.user_id
            }));

            if (msgList.length > 0) {
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
            } else {
                await e.reply('未能获取到图片，请稍后再试。');
            }
        } catch (error) {
            console.error(`Error processing images: ${error}`);
            await e.reply(`发生错误：${error.toString()}`);
        }
    }
}
