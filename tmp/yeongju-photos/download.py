import json,urllib.request,re,html
from pathlib import Path
from PIL import Image,ImageOps,ImageDraw
r=json.loads(Path('tmp/yeongju-photos/results.json').read_text(encoding='utf-8'))
picks={'sosu':0,'buseok':0,'ginseng':0,'fox':1,'muk':2,'donuts':0,'yeonhwa':1,'beef':1,'cheonghwa':0,'hangyeol':1,'naengmyeon':0}
out=Path('public/images/guide/yeongju');out.mkdir(exist_ok=True)
m={}
for k,idx in picks.items():
 i=r[k][idx]['imageinfo'][0]; meta=i['extmetadata']; url=i.get('thumburl',i['url'])
 if k in ['beef','hangyeol'] or not (out/(k+'.webp')).exists():
  req=urllib.request.Request(url,headers={'User-Agent':'AnchaeGuide/1.0'})
  try:data=urllib.request.urlopen(req,timeout=30).read()
  except urllib.error.HTTPError:
   data=urllib.request.urlopen(urllib.request.Request(i['url'],headers={'User-Agent':'AnchaeGuide/1.0'}),timeout=30).read()
  p=out/(k+'.jpg');p.write_bytes(data)
  im=Image.open(p).convert('RGB');im.thumbnail((1200,1200));im.save(out/(k+'.webp'),'WEBP',quality=84);p.unlink()
 im=Image.open(out/(k+'.webp'))
 clean=lambda key:html.unescape(re.sub('<[^>]+>','',meta.get(key,{}).get('value','')))
 m[k]={'src':'/images/guide/yeongju/'+k+'.webp','source':i['descriptionurl'],'author':clean('Artist'),'license':clean('LicenseShortName'),'licenseUrl':clean('LicenseUrl'),'reference':k not in ['sosu','buseok']}
 print(k,im.size,flush=True)
Path('lib/yeongju-guide-images.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
sheet=Image.new('RGB',(800,((len(m)+3)//4)*180),'white');draw=ImageDraw.Draw(sheet)
for n,k in enumerate(m):
 im=ImageOps.fit(Image.open(out/(k+'.webp')),(200,150));x=(n%4)*200;y=(n//4)*180;sheet.paste(im,(x,y));draw.text((x+5,y+154),k,fill='black')
sheet.save('tmp/yeongju-photos/contact.jpg')

