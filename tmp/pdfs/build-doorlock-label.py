from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from pypdf import PdfReader
import pypdfium2 as pdfium

root=Path(__file__).resolve().parents[2]
out=root/'output/pdf/doorlock-palm-instructions-50mm.pdf'
out.parent.mkdir(parents=True,exist_ok=True)
w=50*mm
c=canvas.Canvas(str(out),pagesize=(w,w))
c.setTitle('Wake the keypad | 50 x 50 mm door lock label')
c.setAuthor('VOID ANCHAE')
ink=HexColor('#23352C')
def center(y,txt,size,font='Helvetica'):
 c.setFillColor(ink);c.setFont(font,size)
 c.drawCentredString(w/2,w-y*mm,txt)
c.setFillColor(white);c.rect(0,0,w,w,stroke=0,fill=1)
center(7,'WAKE THE KEYPAD',10,'Helvetica-Bold')
# Simple keypad and open palm drawn as vectors.
c.setStrokeColor(HexColor('#A2ACA4'));c.setLineWidth(.8)
c.roundRect(18*mm, w-25*mm, 14*mm, 14*mm, 2*mm,fill=0,stroke=1)
for x in (21,25,29):
 for y in (14,17,20):
  c.setFillColor(HexColor('#A2ACA4'));c.circle(x*mm,w-y*mm,.55*mm,stroke=0,fill=1)
# Palm covers the keypad; separated fingertips make the gesture clear.
c.setStrokeColor(ink);c.setFillColor(white);c.setLineWidth(1.4)
p=c.beginPath()
p.moveTo(24*mm,w-27*mm)
p.lineTo(21*mm,w-24*mm)
p.lineTo(19*mm,w-20*mm)
p.curveTo(18.5*mm,w-18*mm,20*mm,w-17.5*mm,21*mm,w-19*mm)
p.lineTo(22*mm,w-20.5*mm)
p.lineTo(22*mm,w-14*mm)
p.curveTo(22*mm,w-12.5*mm,24*mm,w-12.5*mm,24*mm,w-14*mm)
p.lineTo(24*mm,w-18*mm)
p.lineTo(24*mm,w-12.5*mm)
p.curveTo(24*mm,w-11*mm,26*mm,w-11*mm,26*mm,w-12.5*mm)
p.lineTo(26*mm,w-18*mm)
p.lineTo(26*mm,w-13.5*mm)
p.curveTo(26*mm,w-12*mm,28*mm,w-12*mm,28*mm,w-13.5*mm)
p.lineTo(28*mm,w-18.5*mm)
p.lineTo(28*mm,w-16*mm)
p.curveTo(28*mm,w-14.5*mm,30*mm,w-14.5*mm,30*mm,w-16*mm)
p.lineTo(30*mm,w-23*mm)
p.curveTo(30*mm,w-25*mm,28*mm,w-26*mm,28*mm,w-27*mm)
p.close();c.drawPath(p,fill=1,stroke=1)
center(32.5,'Touch the keypad with',9)
center(37,'your whole palm.',11,'Helvetica-Bold')
center(41,'Not just a fingertip.',8)
center(46,'When it lights up, enter your code.',7.5)
c.save()
r=PdfReader(str(out));assert len(r.pages)==1
assert abs(float(r.pages[0].mediabox.width)-w)<.01
assert abs(float(r.pages[0].mediabox.height)-w)<.01
doc=pdfium.PdfDocument(str(out))
doc[0].render(scale=5).to_pil().save(root/'tmp/pdfs/doorlock-label-preview.png')
print('Verified one 50 x 50 mm page.')
