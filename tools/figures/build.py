#!/usr/bin/env python3
"""Génère les figures de trading du site (SVG en ligne). Données ILLUSTRATIVES, déterministes, signalées comme telles."""
import random, math, re, sys, pathlib
UP,DN,CY,CU='#52C79A','#E5706A','#5CC8D7','#C98F62'
def f(x): return f'{x:.1f}'
def T(x,y,fr,en,cls='',anchor='start'):
    return f'<text x="{f(x)}" y="{f(y)}" class="{cls}" text-anchor="{anchor}" data-fr="{fr}" data-en="{en}">{fr}</text>'

def hero():
    rnd=random.Random(7); W,H=560,420; L,R,Tp,B=24,536,34,376
    n=30; p=100.0; cs=[]
    for i in range(n):
        o=p; c=o+rnd.gauss(.5 if i>14 else -.2,2.6); h=max(o,c)+abs(rnd.gauss(0,1.3)); l=min(o,c)-abs(rnd.gauss(0,1.3)); cs.append((o,h,l,c)); p=c
    lo=min(c[2] for c in cs)-2; hi=max(c[1] for c in cs)+9
    y=lambda v:B-(v-lo)/(hi-lo)*(B-Tp); step=(R-L-70)/n
    ei=15; entry=cs[ei][3]; stop=entry-5.2; tgt=entry+10.4
    g=''.join(f'<line x1="{L}" x2="{R}" y1="{f(Tp+i*(B-Tp)/5)}" y2="{f(Tp+i*(B-Tp)/5)}" stroke="#0E2A2C" stroke-opacity=".08"/>' for i in range(6))
    ex=L+ei*step+step/2
    zones=(f'<rect x="{f(ex)}" y="{f(y(tgt))}" width="{f(R-ex)}" height="{f(y(entry)-y(tgt))}" fill="{UP}" fill-opacity=".14"/>'
           f'<rect x="{f(ex)}" y="{f(y(entry))}" width="{f(R-ex)}" height="{f(y(stop)-y(entry))}" fill="{DN}" fill-opacity=".14"/>'
           f'<line x1="{f(ex)}" x2="{R}" y1="{f(y(entry))}" y2="{f(y(entry))}" stroke="#0E2A2C" stroke-width="1.4"/>'
           f'<line x1="{f(ex)}" x2="{R}" y1="{f(y(tgt))}" y2="{f(y(tgt))}" stroke="{UP}" stroke-width="1.4" stroke-dasharray="5 4"/>'
           f'<line x1="{f(ex)}" x2="{R}" y1="{f(y(stop))}" y2="{f(y(stop))}" stroke="{DN}" stroke-width="1.4" stroke-dasharray="5 4"/>')
    k=''
    for i,(o,h,l,c) in enumerate(cs):
        x=L+i*step+step/2; col=UP if c>=o else DN
        k+=f'<line x1="{f(x)}" x2="{f(x)}" y1="{f(y(h))}" y2="{f(y(l))}" stroke="{col}" stroke-width="1.4"/><rect x="{f(x-step*.3)}" y="{f(y(max(o,c)))}" width="{f(step*.6)}" height="{f(max(1.5,abs(y(o)-y(c))))}" fill="{col}"/>'
    ma=[sum(c[3] for c in cs[max(0,i-6):i+1])/len(cs[max(0,i-6):i+1]) for i in range(n)]
    mp=' '.join(f'{"M" if i==0 else "L"}{f(L+i*step+step/2)} {f(y(v))}' for i,v in enumerate(ma))
    lab=(T(R-4,y(tgt)-7,'OBJECTIF +2R','TARGET +2R','lb up','end')+T(R-4,y(entry)-7,'ENTRÉE','ENTRY','lb','end')+T(R-4,y(stop)+15,'STOP −1R','STOP −1R','lb dn','end'))
    pin=f'<circle cx="{f(ex)}" cy="{f(y(entry))}" r="5" fill="#0E2A2C"/><circle cx="{f(ex)}" cy="{f(y(entry))}" r="9" fill="none" stroke="#0E2A2C" stroke-opacity=".35"/>'
    return (f'<svg class="fig fig-hero" viewBox="0 0 {W} {H}" role="img" aria-label="Plan de trade sur un graphique en chandeliers : entrée, stop à −1R, objectif à +2R">'
      f'{g}{zones}<path d="{mp}" fill="none" stroke="{CY}" stroke-width="1.8" stroke-opacity=".9"/>{k}{pin}{lab}'
      f'{T(L,H-6,"Plan de trade · rapport risque/rendement 1:2","Trade plan · risk/reward 1:2","cap")}</svg>')

def equity():
    rnd=random.Random(11); W,H=640,420; L,R,Tp,B=56,616,30,330
    n=60; e=0; hw=0; pts=[]; dd=[]
    for i in range(n):
        e+=rnd.gauss(.28,.9); hw=max(hw,e); pts.append(e); dd.append(e-hw)
    ymin,ymax=min(pts)-1,max(pts)+1; x=lambda i:L+i*(R-L)/(n-1); y=lambda v:B-(v-ymin)/(ymax-ymin)*(B-Tp)
    line=' '.join(f'{"M" if i==0 else "L"}{f(x(i))} {f(y(v))}' for i,v in enumerate(pts))
    hwl=''; h=-1e9
    for i,v in enumerate(pts):
        h=max(h,v); hwl+=f'{"M" if i==0 else "L"}{f(x(i))} {f(y(h))} '
    area=f'{line} L{f(x(n-1))} {f(y(ymin))} L{f(x(0))} {f(y(ymin))}Z'
    grid=''.join(f'<line x1="{L}" x2="{R}" y1="{f(Tp+i*(B-Tp)/4)}" y2="{f(Tp+i*(B-Tp)/4)}" stroke="#A7B2BE" stroke-opacity=".14"/><text x="{L-10}" y="{f(Tp+i*(B-Tp)/4+4)}" class="ax" text-anchor="end">{ymax-(ymax-ymin)*i/4:+.0f}R</text>' for i in range(5))
    # drawdown panel
    dB,dT=400,350; dm=min(dd)-.2; yd=lambda v:dT+(v/dm)*(dB-dT)
    dpath=' '.join(f'{"M" if i==0 else "L"}{f(x(i))} {f(yd(v))}' for i,v in enumerate(dd))
    return (f'<svg class="fig" viewBox="0 0 {W} {H}" role="img" aria-label="Courbe d\'equity avec plus haut historique et drawdown">'
      f'{grid}<path d="{area}" fill="{CY}" fill-opacity=".08"/><path d="{hwl}" fill="none" stroke="#A7B2BE" stroke-opacity=".5" stroke-dasharray="3 4"/><path d="{line}" fill="none" stroke="{CY}" stroke-width="2"/>'
      f'<circle cx="{f(x(n-1))}" cy="{f(y(pts[-1]))}" r="4" fill="{CY}"/>'
      f'<path d="{dpath} L{f(x(n-1))} {dT} L{f(x(0))} {dT}Z" fill="{DN}" fill-opacity=".28"/><path d="{dpath}" fill="none" stroke="{DN}" stroke-width="1.4"/>'
      f'{T(L,Tp-12,"EQUITY (R)","EQUITY (R)","lb")}{T(R,Tp-12,"-- plus haut historique","-- high-water mark","ax","end")}{T(L,dT-8,"DRAWDOWN","DRAWDOWN","lb dn")}'
      f'{T(L,H-6,"Exemple illustratif — pas une donnée de marché","Illustrative example — not market data","cap")}</svg>')

def rdist():
    W,H=640,420; L,R,Tp,B=40,616,40,340
    bins=[-3,-2,-1,0,1,2,3,4]; cnt=[1,3,19,4,6,9,5,2]
    n=len(bins); bw=(R-L)/n; m=max(cnt); y=lambda c:B-c/m*(B-Tp-20)
    k=''
    for i,(b,c) in enumerate(zip(bins,cnt)):
        col=DN if b<0 else (UP if b>0 else '#A7B2BE')
        k+=f'<rect x="{f(L+i*bw+bw*.14)}" y="{f(y(c))}" width="{f(bw*.72)}" height="{f(B-y(c))}" fill="{col}" fill-opacity=".85"/><text x="{f(L+i*bw+bw/2)}" y="{f(y(c)-7)}" class="ax" text-anchor="middle">{c}</text><text x="{f(L+i*bw+bw/2)}" y="{B+20}" class="ax" text-anchor="middle">{b:+d}R</text>'
    tot=sum(c*b for b,c in zip(bins,cnt)); mean=tot/sum(cnt); mx=L+(mean-bins[0]+.5)*bw
    return (f'<svg class="fig" viewBox="0 0 {W} {H}" role="img" aria-label="Distribution des résultats en multiples de R, avec la moyenne">'
      f'<line x1="{L}" x2="{R}" y1="{B}" y2="{B}" stroke="#A7B2BE" stroke-opacity=".4"/>{k}'
      f'<line x1="{f(mx)}" x2="{f(mx)}" y1="{Tp-6}" y2="{B}" stroke="{CY}" stroke-width="1.6" stroke-dasharray="4 4"/>'
      f'{T(mx+8,Tp+4,f"MOYENNE {mean:+.2f}R",f"AVERAGE {mean:+.2f}R","lb cy")}{T(L,Tp-18,"DISTRIBUTION DES RÉSULTATS (nombre de trades)","RESULT DISTRIBUTION (number of trades)","lb")}'
      f'{T(L,H-6,"Exemple illustratif — pas une donnée de marché","Illustrative example — not market data","cap")}</svg>')

def discipline():
    W,H=640,420; cx,cy,r=150,190,86; sc=74
    a0=math.radians(-90); a1=a0+2*math.pi*sc/100; ex,ey=cx+r*math.cos(a1),cy+r*math.sin(a1)
    ring=(f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="none" stroke="#A7B2BE" stroke-opacity=".18" stroke-width="12"/>'
          f'<path d="M{cx} {cy-r} A{r} {r} 0 {1 if sc>50 else 0} 1 {f(ex)} {f(ey)}" fill="none" stroke="{CY}" stroke-width="12"/>'
          f'<text x="{cx}" y="{cy+12}" class="big" text-anchor="middle">{sc}</text>{T(cx,cy+38,"DISCIPLINE","DISCIPLINE","lb","middle")}')
    comps=[('Gestion du risque','Risk management',82),('Respect du plan','Plan adherence',76),('Fréquence','Frequency',70),('Psychologie','Psychology',64),('Régularité','Consistency',78)]
    bx,bw=300,300; k=''
    for i,(fr,en,v) in enumerate(comps):
        yy=96+i*56
        k+=T(bx,yy,fr.upper(),en.upper(),'lb')+f'<text x="{bx+bw}" y="{yy}" class="ax" text-anchor="end">{v}</text><rect x="{bx}" y="{yy+10}" width="{bw}" height="6" fill="#A7B2BE" fill-opacity=".18"/><rect x="{bx}" y="{yy+10}" width="{f(bw*v/100)}" height="6" fill="{CY}"/>'
    return (f'<svg class="fig" viewBox="0 0 {W} {H}" role="img" aria-label="Score de discipline sur 100 et ses cinq composantes">{ring}{k}'
      f'{T(20,H-6,"Exemple illustratif — pas une donnée de marché","Illustrative example — not market data","cap")}</svg>')

def weekly():
    rnd=random.Random(3); W,H=1200,380; L,R,Tp,B=48,1160,40,300; n=26
    v=[round(rnd.gauss(.7,1.7),1) for _ in range(n)]; cum=[]; s=0
    for a in v: s+=a; cum.append(s)
    top=max(max(map(abs,v)),1); mid=(Tp+B)/2; bw=(R-L)/n; k=''
    y=lambda a:mid-a/top*(B-Tp)/2*0.9
    for i,a in enumerate(v):
        col=UP if a>=0 else DN; yy=min(y(a),mid); k+=f'<rect x="{f(L+i*bw+bw*.18)}" y="{f(yy)}" width="{f(bw*.64)}" height="{f(abs(y(a)-mid))}" fill="{col}" fill-opacity=".85"/>'
    cm=max(map(abs,cum)); yc=lambda a:mid-a/cm*(B-Tp)/2*0.9
    cp=' '.join(f'{"M" if i==0 else "L"}{f(L+i*bw+bw/2)} {f(yc(c))}' for i,c in enumerate(cum))
    return (f'<svg class="fig fig-wide" viewBox="0 0 {W} {H}" role="img" aria-label="Résultat hebdomadaire en R avec cumul">'
      f'<line x1="{L}" x2="{R}" y1="{f(mid)}" y2="{f(mid)}" stroke="#A7B2BE" stroke-opacity=".4"/>{k}<path d="{cp}" fill="none" stroke="{CY}" stroke-width="2"/>'
      f'{T(L,Tp-18,"RÉSULTAT PAR SEMAINE (R) · LIGNE : CUMUL","WEEKLY RESULT (R) · LINE: CUMULATIVE","lb")}{T(L,H-6,"Exemple illustratif — pas une donnée de marché","Illustrative example — not market data","cap")}</svg>')

if __name__=='__main__':
    p=pathlib.Path(sys.argv[1]); s=p.read_text()
    def sub(pat,new,flags=re.S):
        global s
        s2,c=re.subn(pat,lambda m:new,s,count=1,flags=flags); assert c==1,pat[:50]; s=s2
    sub(r'<div class="hero2-stage".*?</div>\s*(?=<div class="hero2-copy">)','<div class="hero2-fig" aria-hidden="false">'+hero()+'</div>')
    sub(r'(<div class="scene-media"[^>]*>)<picture><source media="\(max-width:700px\)" srcset="/site-assets/scenes/capital-sm.webp">.*?</picture>',r'\1'+equity()) if False else None
    for name,svg in (('capital',equity()),('lattice',rdist()),('psychology',discipline())):
        s2,c=re.subn(r'<picture><source media="\(max-width:700px\)" srcset="/site-assets/scenes/'+name+r'-sm\.webp">.*?</picture>',lambda m:svg,s,count=1,flags=re.S); assert c==1,name; s=s2
    s2,c=re.subn(r'<picture><source media="\(max-width:700px\)" srcset="/site-assets/scenes/discipline-sm\.webp">.*?</picture><figcaption[^>]*>.*?</figcaption>',lambda m:weekly(),s,count=1,flags=re.S); assert c==1; s=s2
    s2,c=re.subn(r'<div class="cta-media" aria-hidden="true">.*?</div>(?=<div class="cta-inner">)','',s,count=1,flags=re.S); assert c==1; s=s2
    p.write_text(s)
