import sys
sys.stdout.reconfigure(encoding="utf-8")
import urllib.request,urllib.parse,json,concurrent.futures
from pathlib import Path
queries={'beef':'Korean beef barbecue','hangyeol':'Cheonggukjang jjigae'}
def get(item):
 k,q=item
 args={'action':'query','generator':'search','gsrsearch':q,'gsrnamespace':6,'gsrlimit':3,'prop':'imageinfo','iiprop':'url|extmetadata','iiurlwidth':960,'format':'json'}
 try:
  req=urllib.request.Request('https://commons.wikimedia.org/w/api.php?'+urllib.parse.urlencode(args),headers={'User-Agent':'AnchaeGuide/1.0'})
  d=json.load(urllib.request.urlopen(req,timeout=25));return k,sorted(d.get('query',{}).get('pages',{}).values(),key=lambda p:p.get('index',0))
 except Exception as e:print(k,str(e));return k,[]
result=dict(concurrent.futures.ThreadPoolExecutor(max_workers=3).map(get,queries.items()))
old=json.loads(Path('tmp/yeongju-photos/results.json').read_text(encoding='utf-8'));old.update(result);result=old
Path('tmp/yeongju-photos/results.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8')
for k,pages in result.items():print(k,[(p['title'],p.get('imageinfo',[{}])[0].get('extmetadata',{}).get('LicenseShortName',{}).get('value')) for p in pages])



