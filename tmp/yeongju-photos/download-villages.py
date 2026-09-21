import urllib.request,json
from pathlib import Path
from PIL import Image
assets=[('seonbi','https://tong.visitkorea.or.kr/cms/resource_photo/55/2643055_image2_1.jpg','https://korean1.visitkorea.or.kr/kor/nphotogallery/photo.kto?func_name=photo_view&newphotoDTO.photo_code=1617022201911018k','ⓒ한국관광공사 사진갤러리-김지호'),('museom','https://tong.visitkorea.or.kr/cms/resource_photo/68/2950268_image2_1.jpg','https://english1.visitkorea.or.kr/enu/nphotogallery/photo.kto?func_name=photo_view&newphotoDTO.photo_code=1617033202111007k','ⓒ한국관광공사 사진갤러리-Anjinho Film')]
p=Path('lib/yeongju-guide-images.json');m=json.loads(p.read_text(encoding='utf-8'))
for key,url,source,author in assets:
 target=Path('tmp/yeongju-photos')/(key+'-original.jpg')
 target.write_bytes(urllib.request.urlopen(url,timeout=30).read())
 im=Image.open(target).convert('RGB');im.thumbnail((1200,1200));im.save('public/images/guide/yeongju/'+key+'.webp',quality=88)
 m[key]={'src':'/images/guide/yeongju/'+key+'.webp','source':source,'author':author,'license':'공공누리 제1유형','licenseUrl':'https://www.kogl.or.kr/info/licenseType1.do','reference':False}
 print(key,im.size)
p.write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
