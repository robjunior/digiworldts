from pathlib import Path
from PIL import Image
im = Image.open(str(Path(__file__).resolve().parent / "colored.png").convert("RGBA")
px=im.load(); tw,th=32,32; cols=26
def dom(t):
    tx=t%cols; ty=t//cols; x0,y0=tx*tw,ty*th
    rs=gs=bs=0;n=0
    for y in range(y0+4,y0+th-4):
        for x in range(x0+4,x0+tw-4):
            r,g,b,a=px[x,y]; rs+=r;gs+=g;bs+=b;n+=1
    return (rs//n, gs//n, bs//n)
for t in [56,57,58,130,2,3,140,4,5,6]:
    print(f"tile value {t}: rgb{dom(t)}")
