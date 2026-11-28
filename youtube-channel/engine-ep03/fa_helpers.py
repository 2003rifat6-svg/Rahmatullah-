import re
from n2w import num2words
def norm(t):
    t = t.replace('$', ' dollars ').replace('%',' percent ').replace('#','').replace('&',' and ')
    t = re.sub(r'(\d),(\d)', r'\1\2', t)
    t = re.sub(r'\d+', lambda m: ' '+num2words(int(m.group()))+' ', t)
    t = re.sub(r"[^a-zA-Z' ]", ' ', t.replace('-', ' ')).lower()
    return [w.strip("'") for w in t.split() if w.strip("'")]
PR={'llamo':'Y AA M OW','snoozed':'S N UW Z D','snoozes':'S N UW Z IH Z','hahaha':'HH AA HH AA HH AA','kiddo':'K IH D OW','licious':'L IH SH AH S','nev':'N EH V','nevster':'N EH V S T ER','nevvy':'N EH V IY'}
