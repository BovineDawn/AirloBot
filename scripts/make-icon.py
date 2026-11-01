"""Rasterize AirloBot's geometric application mark without external dependencies."""
from pathlib import Path
import struct, zlib

OUT = Path(__file__).resolve().parents[1] / 'assets'
OUT.mkdir(exist_ok=True)
def rounded(x, y, left, top, width, height, radius):
    if not left <= x <= left+width or not top <= y <= top+height: return False
    cx = min(max(x, left+radius), left+width-radius)
    cy = min(max(y, top+radius), top+height-radius)
    return (x-cx)**2 + (y-cy)**2 <= radius**2

def pixel(x, y):
    if not rounded(x,y,.5,.5,47,47,14): return (0,0,0,0)
    color = (32,32,32,255) if rounded(x,y,1,1,46,46,13.5) else (72,72,72,255)
    if 23 <= x <= 25 and 8 <= y <= 16: color = (196,196,196,255)
    if (x-24)**2+(y-8)**2 <= 2.5**2: color = (237,237,237,255)
    if rounded(x,y,6,22,4,10,2) or rounded(x,y,38,22,4,10,2): color = (153,153,153,255)
    if rounded(x,y,10,15,28,24,9):
        v = round(241 - 108*min(1,max(0,(x+y-24)/52)))
        color = (v,v,v,255)
    if rounded(x,y,13,19,22,14,6): color = (36,36,36,255)
    if rounded(x,y,17,23,4,6,2) or rounded(x,y,27,23,4,6,2): color = (247,247,247,255)
    if rounded(x,y,20,35,8,2,1): color = (66,66,66,255)
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
(OUT/'airlobot.ico').write_bytes(struct.pack('<HHH',0,1,len(sizes))+b''.join(entries)+b''.join(images))
(OUT/'airlobot.png').write_bytes(images[-1])
print('Created AirloBot PNG and multi-size Windows icon.')
