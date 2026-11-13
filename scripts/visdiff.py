import sys, numpy as np
from PIL import Image
a,b=sys.argv[1],sys.argv[2]
for n in sys.argv[3:]:
    x=np.asarray(Image.open(a+n).convert('RGB')).astype(int); y=np.asarray(Image.open(b+n).convert('RGB')).astype(int)
    d=np.abs(x-y).max(2); print(f"{n:14s} changed>12: {100*(d>12).mean():.2f}%  mean abs diff {np.abs(x-y).mean():.2f}")
