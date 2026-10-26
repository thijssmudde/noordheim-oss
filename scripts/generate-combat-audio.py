"""Original offline weapon sound design: layered transient, filtered noise, bass and decay."""
from pathlib import Path
import math, random, struct, wave
out = Path(__file__).resolve().parents[1] / 'public/audio/combat'
out.mkdir(parents=True, exist_ok=True)
rate = 22050
for index,(name,duration,bass,decay) in enumerate([
    ('rifle',.32,145,20),('machine',.48,110,19),('cannon',1.15,58,6),
    ('rocket',.9,75,7),('artillery',1.5,42,4.8)]):
    rng=random.Random(901+index); low=0.; samples=[]
    for i in range(int(rate*duration)):
        t=i/rate; n=rng.uniform(-1,1); low+=.11*(n-low)
        pulse=math.exp(-t*decay)
        crack=(n-low)*math.exp(-t*(85 if index<2 else 30))*.68
        body=low*2.7*pulse
        thump=math.sin(2*math.pi*(bass*t-18*t*t))*math.exp(-t*(18 if index<2 else 7))*.45
        echo=0 if t<.075 else low*.35*math.exp(-(t-.075)*decay*.7)
        value=(crack+body+thump+echo)*min(1,t/.0015)*min(1,(duration-t)/.03)
        if name=='rocket':value+=low*.8*math.sin(math.pi*t/duration)*math.exp(-t*3)
        samples.append(math.tanh(value*1.5)*.72)
    with wave.open(str(out/f'{name}.wav'),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
        f.writeframes(b''.join(struct.pack('<h',int(max(-1,min(1,x))*32767)) for x in samples))
    print(name,len(samples))
