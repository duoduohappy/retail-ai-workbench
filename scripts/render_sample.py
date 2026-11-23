"""Build a real 15-second silent MP4 template sample, using Pillow and ffmpeg."""
from pathlib import Path
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT/'dist'/'assets'
FONT = 'C:/Windows/Fonts/msyh.ttc'

def font(n):
    return ImageFont.truetype(FONT,n)

def main():
    ASSETS.mkdir(exist_ok=True)
    captions = ['鲜萃燕麦饮 · 日常好物', '适合日常随手选购', '到店了解 · 按需选购']
    for idx,caption in enumerate(captions):
        im=Image.new('RGB',(1280,720),'#102f3c')
        draw=ImageDraw.Draw(im)
        for y in range(720):
            t=y/719
            draw.line((0,y,1280,y),fill=(16+int(t*3),47+int(t*32),60+int(t*7)))
        draw.ellipse((730,10,1400,720),fill='#1b5557')
        draw.text((80,65),'RETAIL OS  /  日常好物',font=font(23),fill='#91d9c9')
        draw.text((80,180),'鲜萃燕麦饮',font=font(58),fill='white')
        draw.text((84,295),caption,font=font(32),fill='#d4e6e1')
        draw.text((80,420),'¥12.90',font=font(76),fill='#a4e8c7')
        draw.text((84,590),'演示商品与价格；以门店实际信息为准',font=font(21),fill='#c3d7d8')
        draw.rounded_rectangle((928,200,1083,515),radius=23,fill='#138b7e')
        draw.rounded_rectangle((946,183,1065,212),radius=4,fill='#dce9df')
        draw.text((947,315),'RETAIL',font=font(29),fill='white')
        draw.text((973,375),'饮料',font=font(24),fill='white')
        draw.text((980,435),'250ml',font=font(18),fill='#cce9df')
        for i in range(3):
            draw.rounded_rectangle((84+i*52,665,124+i*52,669),radius=2,fill='#91d9c9' if idx==i else '#416c73')
        im.save(ASSETS/f'scene-{idx}.png')
        if idx==0:
            im.save(ASSETS/'video-poster.png')
    concat = ASSETS/'frames.txt'
    concat.write_text("\n".join(f"file 'scene-{i}.png'\nduration 5" for i in range(3))+"\nfile 'scene-2.png'\n",encoding='utf-8')
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(concat),'-t','15','-r','25','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(ASSETS/'retail-demo.mp4')],check=True)
    result=subprocess.run(['ffprobe','-v','quiet','-show_entries','format=duration,size','-show_entries','stream=codec_name,width,height','-of','json',str(ASSETS/'retail-demo.mp4')],capture_output=True,text=True,check=True)
    print(result.stdout)

if __name__=='__main__':
    main()
