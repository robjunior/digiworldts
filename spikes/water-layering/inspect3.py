from pathlib import Path
from PIL import Image
im = Image.open(str(Path(__file__).resolve().parent / "colored.png").convert("RGB")
px=im.load(); W,H=im.size; tw=32
def samp(tx,ty):
    x0,y0=tx*tw,ty*tw
    rs=gs=bs=0;n=0
    for y in range(y0+8,y0+tw-8):
        for x in range(x0+8,x0+tw-8):
            r,g,b=px[x,y];rs+=r;gs+=g;bs+=b;n+=1
    return (rs//n,gs//n,bs//n)
print("H rows:",H, "rows of 32:",H//32, "remainder", H%32)
print("col2 row0 (top):", samp(2,0))
print("col2 row10 (bottom):", samp(2,10))
print("col4 row2:", samp(4,2))
print("col2 row2:", samp(2,2))
# where is tile index 2 really? index 2 -> tx=2,ty=0 -> col2,row0 -> green per inspect2
# So GL must be reading from a different row. Let's scan column 2 across all rows:
for ty in range(0,11):
    print(f"col2 row{ty}:", samp(2,ty))
