"""AI-generated still image + deterministic motion + optional locally synthesized narration."""
from pathlib import Path
import tempfile
import json
import subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'dist'/'assets'
FONT='C:/Windows/Fonts/msyh.ttc'

def main():
    image=Image.open(ASSETS/'oat-drink-ai.png').convert('RGB').resize((1280,720))
    captions=['日常好物，轻松选购','鲜萃燕麦饮 · 250ml','欢迎到店，按需选择']
    # Intermediate frames stay outside the source and deployment tree.
    scratch=Path(tempfile.mkdtemp(prefix='retail-ai-film-'))
    scratch.mkdir(parents=True,exist_ok=True)
    for i,caption in enumerate(captions):
        im=image.copy().convert('RGBA')
        overlay=Image.new('RGBA',im.size)
        draw=ImageDraw.Draw(overlay)
        draw.rectangle((0,0,760,720),fill=(2,21,27,110))
        draw.text((65,65),'RETAIL LAB / 日常好物',font=ImageFont.truetype(FONT,22),fill='#91ddc9')
        draw.text((62,188),'鲜萃燕麦饮',font=ImageFont.truetype(FONT,56),fill='white')
        draw.text((65,300),caption,font=ImageFont.truetype(FONT,29),fill='#d7ede5')
        draw.text((65,420),'¥12.90',font=ImageFont.truetype(FONT,67),fill='#a8ebc7')
        draw.text((65,601),'虚构商品演示 · 以门店实际信息为准',font=ImageFont.truetype(FONT,20),fill='#d7e6e2')
        Image.alpha_composite(im,overlay).convert('RGB').save(scratch/f'frame-{i}.png')
    concat=scratch/'frames.txt'
    concat.write_text("\n".join(f"file 'frame-{i}.png'\nduration 5" for i in range(3))+"\nfile 'frame-2.png'\n",encoding='utf-8')
    narration=ASSETS/'retail-narration.wav'
    cmd=['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(concat)]
    if narration.exists():
        probe=subprocess.run(['ffprobe','-v','quiet','-show_entries','format=duration','-of','json',str(narration)],capture_output=True,text=True,check=True)
        duration=float(json.loads(probe.stdout)['format']['duration'])
        tempo=max(1,duration/14)
        if tempo>2:
            raise ValueError('Narration is too long for a 15-second film; shorten the script.')
        cmd+=['-i',str(narration),'-filter_complex',f'[0:v]scale=1320:742,crop=1280:720:20:10,setsar=1[v];[1:a]atempo={tempo:.6f},apad[a]','-map','[v]','-map','[a]','-c:a','aac','-b:a','128k']
    cmd+=['-t','15','-r','25','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',str(ASSETS/'retail-ai-film.mp4')]
    subprocess.run(cmd,check=True)
    print('Built retail-ai-film.mp4; narration='+str(narration.exists()))

if __name__=='__main__':
    main()
