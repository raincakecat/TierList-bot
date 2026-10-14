"""Build the optional PDF guide: python -m pip install reportlab."""
from pathlib import Path
from html import escape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Preformatted

root = Path(__file__).resolve().parents[1]
font_dir = Path('C:/Windows/Fonts')
if (font_dir / 'arial.ttf').exists():
    pdfmetrics.registerFont(TTFont('Guide', str(font_dir / 'arial.ttf')))
    pdfmetrics.registerFont(TTFont('GuideBold', str(font_dir / 'arialbd.ttf')))
    regular, bold = 'Guide', 'GuideBold'
else:
    regular, bold = 'Helvetica', 'Helvetica-Bold'
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='GuideBody', fontName=regular, fontSize=10, leading=14.3,
                          textColor=colors.HexColor('#243447'), spaceAfter=9, wordWrap='LTR'))
styles.add(ParagraphStyle(name='GuideTitle', fontName=bold, fontSize=23, leading=28,
                          textColor=colors.HexColor('#173B62'), spaceAfter=16))
styles.add(ParagraphStyle(name='GuideSubtitle', fontName=bold, fontSize=14, leading=19,
                          textColor=colors.HexColor('#386A83'), spaceAfter=14))
styles.add(ParagraphStyle(name='GuideCode', fontName='Courier', fontSize=8.4, leading=11,
                          leftIndent=10, rightIndent=5, backColor=colors.HexColor('#EFF3F8'),
                          borderPadding=8, spaceBefore=5, spaceAfter=13))
styles.add(ParagraphStyle(name='GuideBullet', parent=styles['GuideBody'], leftIndent=12,
                          firstLineIndent=0, bulletIndent=0, spaceAfter=6))

def markup(text):
    # URLs are live links and otherwise all document text is treated literally.
    import re
    safe = escape(text)
    return re.sub(r'https://[^\s]+', lambda m: '<link href="'+m.group(0)+'" color="#176B9A">'+m.group(0)+'</link>', safe)

story = []
sections = (root / 'docs/full-setup-guide.md').read_text(encoding='utf-8').split('---PAGE---')
for number, section in enumerate(sections):
    if number:
        story.append(PageBreak())
    lines = section.strip().splitlines()
    paragraph, code = [], None
    def flush():
        if paragraph:
            story.append(Paragraph(markup(' '.join(paragraph)), styles['GuideBody']))
            paragraph.clear()
    for line in lines:
        if line.startswith('```'):
            flush()
            if code is None:
                code = []
            else:
                story.append(Preformatted('\n'.join(code), styles['GuideCode']))
                code = None
        elif code is not None:
            code.append(line)
        elif line.startswith('# '):
            flush(); story.append(Paragraph(markup(line[2:]), styles['GuideTitle']))
        elif line.startswith('## '):
            flush(); story.append(Paragraph(markup(line[3:]), styles['GuideSubtitle']))
        elif line.startswith('- '):
            flush(); story.append(Paragraph(markup(line[2:]), styles['GuideBullet'], bulletText='-'))
        elif not line.strip():
            flush()
        else:
            paragraph.append(line)
    flush()

def frame(canvas, doc):
    w, h = doc.pagesize
    canvas.saveState()
    canvas.setFillColor(colors.HexColor('#173B62'))
    canvas.rect(0, h-10, w, 10, fill=1, stroke=0)
    canvas.setStrokeColor(colors.HexColor('#D8E3EF'))
    canvas.line(48, 43, w-48, 43)
    canvas.setFillColor(colors.HexColor('#62758B'))
    canvas.setFont(regular, 8)
    canvas.drawString(48, 29, 'CRYSTAL BOT  /  SETUP & OPERATIONS  /  v0.1.1')
    canvas.drawRightString(w-48, 29, str(doc.page))
    canvas.restoreState()

destination = root / 'docs/Full-Setup-Guide.pdf'
SimpleDocTemplate(str(destination), pagesize=(612,792), leftMargin=48, rightMargin=48,
                  topMargin=42, bottomMargin=58, title='Crystal Bot - Full Setup Guide',
                  author='TierList-bot project', subject='Installation, configuration, hosting and recovery').build(
                      story, onFirstPage=frame, onLaterPages=frame)
print(f'Created {destination}')
