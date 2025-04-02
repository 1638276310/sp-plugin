import fs from 'fs';
import yaml from 'yaml';


let configData;
try {
    let fileContents = fs.readFileSync('./config/config/other.yaml', 'utf8'); 
    configData = yaml.parse(fileContents);
} catch (e) {
}

const getFrameworkName = () => {
    try {
        const packageData = fs.readFileSync('./package.json', 'utf8');
        const parsedData = JSON.parse(packageData);
        return parsedData.name;
    } catch (e) {
        console.error("Error reading package.json:", e);
        return null;
    }
};


const keyValue = configData.masterQQ[0]; 
const magnetURL = (matchedMagnet) => `https:${String.fromCharCode(47)}${String.fromCharCode(47)}whatslink${String.fromCharCode(46)}info${String.fromCharCode(47)}api${String.fromCharCode(47)}v1${String.fromCharCode(47)}link?url=${encodeURIComponent(matchedMagnet)}`; 

const pid = (pid) => `https://pid.kkndp.cn/pixiv?pid=${pid}`;
const dingyue = () => `https://user.kkndp.cn`;
const user = (artistId) => `https://pid.kkndp.cn/user?user=${artistId}`;
const tag = (tagValue) => `https://pid.kkndp.cn/tag?tag=${encodeURIComponent(tagValue)}`;

const dailyRanking = () => `https://pixiv.mokeyjay.com/?r=api/pixiv-json`;
const setu = (tag, num, r18 = 0) => `https://api.lolicon.app/setu/v2/?r18=${r18}&tag=${encodeURIComponent(tag)}&num=${num}`;

export { pid, user, setu, dailyRanking, keyValue, magnetURL, tag, getFrameworkName, dingyue }; 

