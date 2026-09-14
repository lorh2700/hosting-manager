from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from pypdf import PdfReader
import pypdfium2 as pdfium
from PIL import Image, ImageOps

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'output/pdf'
OUT.mkdir(parents=True,exist_ok=True)
DATA=json.loads((Path(__file__).parent/'checkout-card-data.json').read_text(encoding='utf-8'))
DATA=[d for d in DATA if d['slug'] != 'dowonjae']
pdfmetrics.registerFont(TTFont('Korean','C:/Windows/Fonts/malgun.ttf'))
pdfmetrics.registerFont(TTFont('KoreanBold','C:/Windows/Fonts/malgunbd.ttf'))
pdfmetrics.registerFont(TTFont('Serif','C:/Windows/Fonts/georgia.ttf'))
INK=HexColor('#303A32')
MUTED=HexColor('#5B635C')
LINE=HexColor('#C5CBBF')
ACCENT=HexColor('#9B7652')
W,H=148*mm,210*mm
pdf=OUT/'void-anchae-checkout-cards-A5.pdf'
c=canvas.Canvas(str(pdf),pagesize=(W,H),pageCompression=1)
c.setTitle('VOID ANCHAE | A5 Express Check-out Cards | 4 Properties')
c.setAuthor('VOID ANCHAE')
def text(x,y,s,size=10,font='Korean',color=INK,align='left'):
 c.setFont(font,size);c.setFillColor(color)
 assert pdfmetrics.stringWidth(s,font,size) <= W-24*mm, s
 getattr(c,{'left':'drawString','center':'drawCentredString','right':'drawRightString'}[align])(x*mm,H-y*mm,s)
def line(x1,y1,x2,y2,color=LINE,width=.5):
 c.setStrokeColor(color);c.setLineWidth(width);c.line(x1*mm,H-y1*mm,x2*mm,H-y2*mm)
for i,d in enumerate(DATA):
 c.setFillColor(white);c.rect(0,0,W,H,fill=1,stroke=0)
 # Quiet, architectural frame; enough safe area for home printers.
 text(14,16,'VOID ANCHAE',10,'Helvetica',align='left')
 text(134,16,d['name'],11,'KoreanBold',align='right')
 line(14,21,134,21)
 text(74,37,'A gentle farewell.',25,'Serif',align='center')
 text(74,49,'체크아웃 안내',18,'KoreanBold',align='center')
 text(74,58,'함께한 시간이 편안한 기억으로 남기를 바랍니다.',9,color=MUTED,align='center')
 # Checkout time comes from the property's public display configuration.
 c.setFillColor(HexColor('#F2F3EE'));c.roundRect(14*mm,H-80*mm,120*mm,15*mm,2*mm,stroke=0,fill=1)
 text(20,74.5,'CHECK-OUT',8,'Helvetica',color=MUTED)
 text(128,75,'오전 11시까지  /  BY 11:00 AM',11,'KoreanBold',align='right')
 # Pure vector QR, 4-module white quiet zone on every side.
 size=d['size']; total=size+8; side=58*mm; unit=side/total
 left=(W-side)/2; bottom=H-144*mm
 c.setFillColor(white);c.rect(left,bottom,side,side,stroke=0,fill=1)
 c.setFillColor(HexColor('#111111'))
 for row in range(size):
  for col in range(size):
   if d['matrix'][row*size+col]:
    c.rect(left+(col+4)*unit,bottom+(size-row+3)*unit,unit,unit,stroke=0,fill=1)
 # Screen users can also follow the QR link; the printed URL is encoded only.
 c.linkURL(d['url'],(left,bottom,left+side,bottom+side),relative=0,thickness=0)
 text(74,154,'Express Check-out',18,'Serif',align='center')
 text(74,164,'퇴실 후 QR을 스캔하고 링크를 열면 자동 체크아웃됩니다.',9.5,align='center')
 text(74,174,'After leaving, scan the QR code and open the link.',9,'Helvetica',align='center')
 text(74,180,'Check-out is automatic.',9,'Helvetica',align='center')
 line(14,189,134,189)
 text(74,195,'별도 합의한 퇴실 시간이 있다면 그 시간을 따라주세요.',7.4,color=MUTED,align='center')
 text(74,199,'연결되지 않으면 예약 채널로 호스트에게 알려주세요.',7.4,color=MUTED,align='center')
 text(74,204,'Agreed late check-out applies. Need help? Message your host.',7.4,'Helvetica',color=MUTED,align='center')
 c.showPage()
c.save()
reader=PdfReader(str(pdf))
assert len(reader.pages)==4
for page,d in zip(reader.pages,DATA):
 assert abs(float(page.mediabox.width)-W)<.01 and abs(float(page.mediabox.height)-H)<.01
 assert d['name'] in page.extract_text()
 assert 'Express Check-out' in page.extract_text()
 assert 'Please wait for confirmation' not in page.extract_text()
 assert '화면에 체크아웃 완료가 표시되는지 확인해주세요.' not in page.extract_text()
 assert page['/Annots'][0].get_object()['/A']['/URI']==d['url']
doc=pdfium.PdfDocument(str(pdf))
thumbs=[]
for i,page in enumerate(doc):
 img=page.render(scale=2).to_pil().convert('RGB')
 img.save(Path(__file__).parent/f'checkout-card-{i+1}.png')
 thumb=img.copy();thumb.thumbnail((420,596));thumbs.append(thumb)
sheet=Image.new('RGB',(440*2,620*2),'#D6D8D3')
for i,img in enumerate(thumbs):sheet.paste(img,((i%2)*440+10,(i//2)*620+10))
sheet.save(Path(__file__).parent/'checkout-contact-sheet.png')
print('Created 4 A5 pages; revised copy, dimensions, names and QR destinations verified.')
print(pdf)
