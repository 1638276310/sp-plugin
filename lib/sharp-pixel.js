/**
 * 纯 Sharp 实现「随机彩色噪点」
 * 与原 python3 modify_image.py 行为 100% 对齐：
 *   入参：文件绝对/相对路径
 *   返回：修改后的文件绝对路径（*_modified.*）
 *   失败：抛 Error
 */
import sharp from "sharp";
import fs from "fs";
import path from "path";

/**
 * 在图像上添加随机彩色噪点
 * 
 * 该函数会读取指定图像文件，在随机位置上添加指定数量的随机颜色像素点，
 * 然后将修改后的图像保存为新文件（文件名添加"_modified"后缀）。
 * 像素点的数量在10到60之间随机选择。
 * 
 * @async
 * @function modifyImageSharp
 * @param {string} inputPath - 输入图像的路径（绝对路径或相对路径）
 * @returns {Promise<string>} 修改后的图像文件绝对路径
 * @throws {Error} 当输入文件不存在时抛出错误
 * 
 * @example
 * // 基本用法
 * const result = await modifyImageSharp('./image.png');
 * console.log(`处理完成，文件保存为: ${result}`);
 * 
 * @example
 * // 错误处理
 * try {
 *   const result = await modifyImageSharp('./nonexistent.png');
 * } catch (error) {
 *   console.error(`处理失败: ${error.message}`);
 * }
 * 
 * @description
 * 算法流程：
 * 1. 解析并验证输入路径
 * 2. 构造输出路径（添加"_modified"后缀）
 * 3. 使用Sharp读取图像，确保有Alpha通道并获取原始像素数据
 * 4. 随机选择10-60个像素点
 * 5. 为每个选中的像素点分配随机RGB值，并将Alpha值设为255
 * 6. 将修改后的像素数据写回新文件
 * 
 * 注意：原始Alpha通道会被移除，所有像素点的不透明度将恢复为完全不透明。
 * 这是为了与原始Python实现的行为完全一致。
 */
export async function modifyImageSharp(inputPath) {
    const absIn = path.isAbsolute(inputPath)
        ? inputPath
        : path.join(process.cwd(), inputPath);
    if (!fs.existsSync(absIn)) throw new Error(`文件不存在：${absIn}`);

    const { dir, name, ext } = path.parse(absIn);
    const absOut = path.join(dir, `${name}_modified${ext}`);

    const { data, info } = await sharp(absIn)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    const pixelCount = Math.floor(Math.random() * 51) + 10; // 10~60

    for (let i = 0; i < pixelCount; i++) {
        const x = Math.floor(Math.random() * width);
        const y = Math.floor(Math.random() * height);
        const idx = (y * width + x) * channels;
        data[idx] = Math.floor(Math.random() * 256); // R
        data[idx + 1] = Math.floor(Math.random() * 256); // G
        data[idx + 2] = Math.floor(Math.random() * 256); // B
        data[idx + 3] = 255; // A
    }

    await sharp(data, { raw: { width, height, channels } })
        .removeAlpha()
        .toFile(absOut);

    return absOut;
}