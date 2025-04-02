from PIL import Image
import random
import sys


def add_random_pixels(image_path):
    image = Image.open(image_path)
    
    # 仅在必要时进行模式转换
    if image.mode not in ['RGB', 'RGBA']:
        image = image.convert('RGB')
    
    pixels = image.load()
    width, height = image.size
    random_pixel_count = random.randint(10, 60)

    for _ in range(random_pixel_count):
        x = random.randint(0, width - 1)
        y = random.randint(0, height - 1)
        color = (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))  # RGB颜色
        pixels[x, y] = color

    output_path = image_path.replace('.jpg', '_modified.jpg')

    # 确保输出为RGB模式
    if image.mode == 'RGBA':
        image = image.convert('RGB')

    image.save(output_path)
    return output_path


if __name__ == '__main__':
    input_image_path = sys.argv[1]
    output_image_path = add_random_pixels(input_image_path)
    print(output_image_path)
