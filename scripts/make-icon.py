"""Rasterize CrocBot's geometric application mark without external dependencies."""
from pathlib import Path
import struct, zlib

OUT = Path(__file__).resolve().parents[1] / 'assets'
OUT.mkdir(exist_ok=True)
MINT = (199, 246, 160, 255)
DARK = (23, 55, 37, 255)
PALE = (215, 251, 178, 255)
BODY = [(11,21),(19,21),(23,15),(30,15),(33,21),(38,21),(38,30),(25,30),(19,36),(11,36)]

def inside(x, y, points):
    result = False
    for i, a in enumerate(points):
        b = points[i-1]
        if (a[1] > y) != (b[1] > y) and x < (b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:
            result = not result
    return result

def pixel(x, y):
    cx, cy = min(max(x, 13), 35), min(max(y, 13), 35)
    if (x-cx)**2 + (y-cy)**2 > 13**2: return (0,0,0,0)
    color = DARK if inside(x,y,BODY) else MINT
    if any(inside(x,y,[(p,29),(p+3,34),(p+6,29)]) for p in [22,28]): color = DARK
    if (x-28)**2+(y-20)**2 < 4 or 13 <= x <= 36 and 25 <= y <= 27: color = PALE
    return color

def png(size):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = [pixel((x+(sx+.5)/2)*48/size,(y+(sy+.5)/2)*48/size) for sx in range(2) for sy in range(2)]
            rows.extend(round(sum(p[c] for p in samples)/4) for c in range(4))
    def chunk(kind, data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(rows,9))+chunk(b'IEND',b'')

sizes = [16,32,48,64,128,256]
images = [png(s) for s in sizes]
offset = 6 + 16*len(sizes)
entries = []
for size, data in zip(sizes, images):
    entries.append(struct.pack('<BBBBHHII',size%256,size%256,0,0,1,32,len(data),offset))
    offset += len(data)
(OUT/'crocbot.ico').write_bytes(struct.pack('<HHH',0,1,len(sizes))+b''.join(entries)+b''.join(images))
(OUT/'crocbot.png').write_bytes(images[-1])
print('Created CrocBot PNG and multi-size Windows icon.')
