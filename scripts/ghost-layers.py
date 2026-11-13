# New mascot → animated layers. Inputs: ref/ghost-new-white.jpg (chosen art) + ref/ghost-new-black.jpg (alpha helper).
import numpy as np, cv2, json, os
from PIL import Image
R='/workspace/ghost-gift-media/ref/'; OUT='/workspace/ghost-gift-media/ghost2/out/'; os.makedirs(OUT, exist_ok=True)
W=cv2.imread(R+'ghost-new-white.jpg').astype(np.float32)
B=cv2.imread(R+'ghost-new-black.jpg').astype(np.float32)
Hh,Ww=W.shape[:2]
B=cv2.warpAffine(B,np.float32([[1,0,-0.37],[0,1,-1.91]]),(Ww,Hh),flags=cv2.INTER_CUBIC,borderMode=cv2.BORDER_REPLICATE)
wb=np.array([253.8,253.6,253.7],np.float32)
a=1-np.clip(((W-B)/wb).mean(2),0,1); a[a<0.025]=0
A3=np.maximum(a,1e-3)[...,None]
Cw=(W-(1-A3)*wb)/A3; Cb=B/A3
t=np.clip((a-0.45)/0.3,0,1)[...,None]
C=np.clip(Cb*(1-t)+Cw*t,0,255)           # glow edges from the black plate, body from the white plate
yy,xx=np.mgrid[0:Hh,0:Ww]
def poly(pts):
    m=np.zeros((Hh,Ww),np.uint8); cv2.fillPoly(m,[np.array(pts,np.int32)],255); return m>0
def feather(m,r): return cv2.GaussianBlur(m.astype(np.float32),(0,0),r)
hsv=cv2.cvtColor(W.astype(np.uint8),cv2.COLOR_BGR2HSV); s=hsv[...,1].astype(int); v=hsv[...,2].astype(int)

# components: main blob + sparkles
n,lab,st,cen=cv2.connectedComponentsWithStats((a>0.35).astype(np.uint8))
main=1+np.argmax(st[1:,4]); mainM=lab==main
sparks=[]
for i in range(1,n):
    if i==main: continue
    m=cv2.dilate((lab==i).astype(np.uint8),np.ones((3,3),np.uint8),iterations=14)>0
    m&=~cv2.dilate(mainM.astype(np.uint8),np.ones((3,3),np.uint8),iterations=4).astype(bool)
    sparks.append((i,m,st[i],cen[i]))
sparkAll=np.zeros_like(mainM)
for _,m,_,_ in sparks: sparkAll|=m

# ring loops (outside the body)
LEFT=[(0,300),(470,300),(472,390),(440,430),(410,500),(395,570),(340,572),(285,592),(258,630),(262,680),(300,730),(360,780),(410,815),(430,860),(0,900)]
RIGHT=[(1500,830),(1400,830),(1360,855),(1320,880),(1300,900),(1330,950),(1355,1030),(1350,1090),(1330,1125),(1500,1170)]
ringL=poly(LEFT)&(a>0)&~sparkAll; ringR=poly(RIGHT)&(a>0)&~sparkAll
dil=lambda m,r: cv2.dilate(m.astype(np.uint8),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(2*r+1,2*r+1)))>0
ringLx=dil(ringL,7)&(a>0)&~sparkAll; ringRx=dil(ringR,7)&(a>0)&~sparkAll

# visor / eyes
head=(xx>600)&(xx<1150)&(yy>350)&(yy<740)
nv,lv,sv,_=cv2.connectedComponentsWithStats(((v<90)&head).astype(np.uint8))
vis=(lv==1+np.argmax(sv[1:,4])).astype(np.uint8)
hull=cv2.convexHull(cv2.findNonZero(vis)); visF=np.zeros_like(vis); cv2.fillConvexPoly(visF,hull,1)
inner=cv2.erode(visF,np.ones((3,3),np.uint8),iterations=10)>0
eyeCore=inner&(v>215)
ne,le,se,ce=cv2.connectedComponentsWithStats(eyeCore.astype(np.uint8))
eyes=[]
for j in range(1,ne):
    if se[j,4]<800 or ce[j][1]>700 or se[j,4]>40000: continue
    pts=cv2.findNonZero((le==j).astype(np.uint8)); (ex,ey),(ea,eb),ang=cv2.fitEllipse(pts); eyes.append((ex,ey,ea,eb,ang))
eyes=[e for e in eyes if e[1]<700 and e[2]<200]; eyes.sort()
print('eyes',[tuple(round(x,1) for x in e) for e in eyes])
eyeM=np.zeros((Hh,Ww),np.uint8)
for ex,ey,ea,eb,ang in eyes: cv2.ellipse(eyeM,((ex,ey),(ea+70,eb+70),ang),1,-1)
eyeM=(eyeM>0)&inner

# chest star
chest=(xx>760)&(xx<1130)&(yy>680)&(yy<1040)
ns,ls,ss,cs=cv2.connectedComponentsWithStats(((s<70)&(v>170)&chest).astype(np.uint8))
k=1+np.argmax(ss[1:,4]); sm=(ls==k).astype(np.uint8)
cnts,_=cv2.findContours(sm,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE); sf=np.zeros_like(sm); cv2.drawContours(sf,cnts,-1,1,-1)
starM=cv2.dilate(sf,np.ones((3,3),np.uint8),iterations=16)>0
starCx,starCy=cs[k]

# arms / tail: hard cut for the core at the outer edge of a feather band; the overlay fades in across the band
def limb(region_pts, line_p, line_q, side_pt, band=34):
    p=np.array(line_p,float); q=np.array(line_q,float); d=q-p; nrm=np.array([-d[1],d[0]]); nrm/=np.linalg.norm(nrm)
    if np.dot(np.array(side_pt,float)-p,nrm)<0: nrm=-nrm
    dist=(xx-p[0])*nrm[0]+(yy-p[1])*nrm[1]            # >0 toward the limb tip
    reg=poly(region_pts)&(a>0)&~sparkAll&~ringL&~ringR
    over=reg&(dist>-band)
    f=np.clip((dist+band)/band,0,1)                   # 0 inside body … 1 at the cut
    coreCut=reg&(dist>0)
    pivot=((p+q)/2).tolist()
    return over,f,coreCut,pivot
armL=limb([(180,598),(398,598),(400,645),(462,852),(180,852)],(400,645),(460,850),(300,680))
armR=limb([(1205,600),(1500,600),(1500,830),(1400,830),(1360,855),(1320,880),(1288,880),(1205,665)],(1205,665),(1290,875),(1380,700))
tail=limb([(240,1000),(345,1000),(490,1232),(490,1275),(240,1275)],(345,1000),(490,1232),(320,1150))

# core
coreA=a.copy()
for m in (ringL,ringR,sparkAll): coreA[m]=0
for _,_,cut,_ in (armL,armR,tail): coreA[cut]=0
img8=np.clip(C,0,255).astype(np.uint8)
visI=cv2.erode(visF,np.ones((3,3),np.uint8),iterations=8)
bx,by,bw,bh=cv2.boundingRect(visF)
base=np.median(img8[(visF>0)&(v<55)],axis=0).astype(np.float32)
ty=np.clip((yy-by)/bh,0,1)[...,None]; tx=np.clip((xx-bx)/bw,0,1)[...,None]
fill=base*(0.75+0.55*ty)+np.array([30,6,18],np.float32)*ty*(1-tx)
fm=feather(visI>0,4)[...,None]
coreC=np.clip(img8*(1-fm)+fill*fm,0,255).astype(np.uint8)
coreC=cv2.inpaint(coreC,starM.astype(np.uint8)*255,22,cv2.INPAINT_TELEA)
# soften the inpainted star patch so it reads as plain body glass if it ever peeks out
bl=cv2.GaussianBlur(coreC,(0,0),10); sm2=feather(starM,6)[...,None]; coreC=(coreC*(1-sm2)+bl*sm2).astype(np.uint8)

# export
X0,Y0,S=45,55,1450; CANVAS=640; K=CANVAS/S
meta={'frame':[X0,Y0,S],'canvas':CANVAS,'layers':{}}
def export(name,color,alpha,pivot=None,q=86):
    al=np.clip(alpha,0,1)
    ys,xs=np.nonzero(al>0.01)
    x0,x1,y0,y1=xs.min()-4,xs.max()+5,ys.min()-4,ys.max()+5
    x0=max(x0,0);y0=max(y0,0);x1=min(x1,Ww);y1=min(y1,Hh)
    rgba=np.dstack([color[y0:y1,x0:x1,::-1].astype(np.uint8),(al[y0:y1,x0:x1]*255).astype(np.uint8)])
    im=Image.fromarray(rgba,'RGBA'); w=max(1,round((x1-x0)*K)); h=max(1,round((y1-y0)*K))
    im=im.resize((w,h),Image.LANCZOS); im.save(OUT+name+'.webp','WEBP',quality=q,method=6)
    L={'x':(x0-X0)/S*100,'y':(y0-Y0)/S*100,'w':(x1-x0)/S*100,'h':(y1-y0)/S*100}
    if pivot: L['ox']=(pivot[0]-x0)/(x1-x0)*100; L['oy']=(pivot[1]-y0)/(y1-y0)*100
    meta['layers'][name]=L; print(name,w,h,os.path.getsize(OUT+name+'.webp'))
export('core',coreC.astype(np.float32),coreA,pivot=(770,1400))
export('ringL',C,a*ringLx,pivot=(430,600))
export('ringR',C,a*ringRx,pivot=(1335,1110))
for nm,(over,f,cut,pv) in (('armL',armL),('armR',armR),('tail',tail)):
    export(nm,C,a*over*f,pivot=pv)
export('star',C,a*feather(starM,2.5),pivot=(starCx,starCy))
for idx,(i,m,stt,cc) in enumerate(sorted(sparks,key=lambda z:-z[2][4])):
    export(f'sp{idx}',C,a*m,pivot=tuple(cc))
meta['eyes']=[{'cx':(ex-X0)/S*100,'cy':(ey-Y0)/S*100,'w':ea/S*100,'h':eb/S*100,'rot':ang} for ex,ey,ea,eb,ang in eyes]
meta['visor']={'x':(cv2.boundingRect(visF)[0]-X0)/S*100,'y':(cv2.boundingRect(visF)[1]-Y0)/S*100,'w':cv2.boundingRect(visF)[2]/S*100,'h':cv2.boundingRect(visF)[3]/S*100}
meta['star']={'cx':(starCx-X0)/S*100,'cy':(starCy-Y0)/S*100}
meta['ring']={'cx':(765-X0)/S*100,'cy':(825-Y0)/S*100,'rx':759/S*100,'ry':355/S*100,'rot':17.2}
json.dump(meta,open(OUT+'meta.json','w'),indent=1)
# full flattened (for share card / tiny logo fallback / QA)
full=np.dstack([np.clip(C,0,255)[...,::-1].astype(np.uint8),(a*255).astype(np.uint8)])
fi=Image.fromarray(full,'RGBA').crop((X0,Y0,X0+S,Y0+S))
for sz in (96,192,320): fi.resize((sz,sz),Image.LANCZOS).save(OUT+f'flat-{sz}.webp','WEBP',quality=88,method=6)
