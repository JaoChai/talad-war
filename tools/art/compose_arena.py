"""Compose the arena background: painted empty floor + obstacle props on the sim's OBSTACLES.

Usage: compose_arena.py FLOOR.png OBSTACLES.png OUT.png  (then save OUT as public/art/arena_market.webp, q80)
FLOOR fills the whole 40x24 world (side awnings stay in the letterbox margins); OBSTACLES is a magenta-key sheet
of three props (bench, cart, basket stack). Positions below MUST match packages/sim/src/map.ts OBSTACLES.
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
floor_p, obs_p, out = sys.argv[1:4]
W,H=1920,1080; S=H/24; OX=(W-40*S)/2
floor=Image.open(floor_p).convert('RGB').resize((W,H),Image.LANCZOS).convert('RGBA')
a=np.asarray(Image.open(obs_p).convert('RGB')).astype(int)
d=np.sqrt(((a-[255,0,255])**2).sum(-1))
cand=d<90
lab,_=ndi.label(cand)
border=set(np.unique(np.concatenate([lab[0],lab[-1],lab[:,0],lab[:,-1]])))-{0}
bg=np.isin(lab,list(border))
bg|=(np.minimum(a[...,0],a[...,2])-a[...,1])>70
fg=~bg
fg=ndi.binary_opening(fg,iterations=2)
lab,n=ndi.label(ndi.binary_dilation(fg,iterations=6))
objs=sorted([(s,i+1) for i,s in enumerate(ndi.find_objects(lab))],key=lambda t:-(t[0][0].stop-t[0][0].start)*(t[0][1].stop-t[0][1].start))[:3]
objs=sorted(objs,key=lambda t:t[0][1].start)
rgba=np.dstack([a,(fg*255)]).astype(np.uint8)
sprites=[]
for sl,i in objs:
    m=(lab[sl]==i)&fg[sl]; c=rgba[sl].copy(); c[...,3]=m*255
    sprites.append(Image.fromarray(c))
print([s.size for s in sprites])
bench,cart,stack=sprites
place=[((4,9,6,12),stack),((34,12,36,15),stack),((14,4,17,6),cart),((23,18,26,20),cart),((18,3,22,4),bench),((18,20,22,21),bench)]
for (x0,y0,x1,y1),sp in place:
    w=(x1-x0)*S*1.15; sc=w/sp.size[0]; h=sp.size[1]*sc
    im=sp.resize((round(w),round(h)),Image.LANCZOS)
    cx=OX+(x0+x1)/2*S; by=y1*S+0.15*S
    # soft contact shadow
    sh=Image.new('RGBA',im.size,(0,0,0,0)); 
    from PIL import ImageDraw, ImageFilter
    shl=Image.new('RGBA',(W,H),(0,0,0,0)); dd=ImageDraw.Draw(shl)
    dd.ellipse([cx-w*0.52,by-(y1-y0)*S*0.75,cx+w*0.52,by+0.1*S],fill=(20,10,30,110))
    floor=Image.alpha_composite(floor,shl.filter(ImageFilter.GaussianBlur(8)))
    floor.alpha_composite(im,(round(cx-w/2),round(by-h)))
floor.convert('RGB').save(out)
