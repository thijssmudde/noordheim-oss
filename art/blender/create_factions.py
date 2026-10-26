"""Faction signature equipment: one structure and two troops per faction.
Fjordborn: Strandhogg raiding camp, Fjord raider, Varg snowmobile.
Ironclad: Bergverk armory, sapper, Mjolnir siege mortar.
Hearthkin: Lade storehouse, hearth militia, Bulwark plough tank.
Ashwalkers: Varde watchtower, Ember marksman, Fenrir scout car.
Run through Blender MCP (scripts/blender-mcp.py factions) or pnpm art:tactical factions.
Blender is the editable source; every model is original Noordheim work.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tactical'
OUT.mkdir(parents=True, exist_ok=True)
for o in list(bpy.data.objects):bpy.data.objects.remove(o,do_unlink=True)
for block in (bpy.data.meshes,bpy.data.materials,bpy.data.images,bpy.data.cameras,bpy.data.lights):
 for item in list(block):block.remove(item,do_unlink=True)
M={}
colors={'armor':'697976','snow':'c2c9bf','dark':'202c30','rubber':'161e21','steel':'46575e','trim':'4299b6','glass':'163e50','light':'c0f3f4','red':'78433b','wood':'78644e','concrete':'8d9892','gold':'c8ab64','skin':'b79b80','orange':'d57e43','tar':'2b2724','canvas':'a89a78','rope':'b9a37a','stone':'7d8582','turf':'5f6b3a','ember':'d9552c','leather':'5a4636'}
def linear(c):
 return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
for key,h in colors.items():
 m=bpy.data.materials.new('culture_trim' if key=='trim' else key);m.diffuse_color=tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))+(1,);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.75 if key in ['wood','concrete','rubber','tar','canvas','rope','stone','turf','leather'] else .4
 if key in ['steel','armor']:p.inputs['Metallic'].default_value=.45
 if key in ['light','trim','ember']:p.inputs['Emission Color'].default_value=m.diffuse_color;p.inputs['Emission Strength'].default_value={'light':.7,'trim':.12,'ember':1.4}[key]
 M[key]=m
S={'root':None}
allroots=[]
def own(o,name,mat):
 o.name=name;o.parent=S['root'];o.data.materials.append(M[mat]);return o

def box(name,size,p,mat='armor',bevel=.04,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_cube_add(size=1,location=p);o=own(bpy.context.object,name,mat);o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler=rotation
 if bevel:
  m=o.modifiers.new('Machined edges','BEVEL');m.width=bevel;m.segments=2
  o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
 return o

def cyl(name,r,d,p,mat='steel',rotation=(0,0,0),vertices=16):
 bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d,location=p);o=own(bpy.context.object,name,mat);o.rotation_euler=rotation
 m=o.modifiers.new('Rim','BEVEL');m.width=.015;m.segments=2
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def beam(a,b,r=.03,mat='steel'):
 a,b=Vector(a),Vector(b);o=cyl('Brace',r,(b-a).length,(a+b)/2,mat);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def sphere(name,p,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=p);o=own(bpy.context.object,name,mat);o.scale=scale;return o

def mesh(name,verts,faces,mat):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces+[tuple(reversed(f)) for f in faces]);d.update()
 o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);return own(o,name,mat)

def empty(name,loc,parent):
 e=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(e);e.parent=parent;e.location=loc;return e

def new(name):
 root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root);root['tactical_kind']=name;S['root']=root;allroots.append(root)

def gable(y,w,z0,z1,mat):
 mesh('Gable',[(-w/2,y,z0),(w/2,y,z0),(0,y,z1)],[(0,1,2)],mat)

def pitched(w,d,y,top,rise,mat,thickness=.14,overhang=.3,seams=True):
 angle=math.atan2(rise,w/2)
 for side in [-1,1]:
  box('Pitched roof',(math.hypot(w/2,rise)+overhang,d+.7,thickness),(side*w/4,y,top+rise/2),mat,.01,(0,side*angle,0))
  if seams:
   for i in range(int(d/.55)+1):beam((0,y-d/2+i*.55,top+rise+.06),(side*(w/2+.22),y-d/2+i*.55,top-.04),.028,'snow')
 box('Ridge cap',(.18,d+.9,.1),(0,y,top+rise+.08),'snow',.02)

# Infantry share the Jaeger rig so the runtime leg animation applies to every faction.
def legs(trouser):
 for side in [-1,1]:
  previous=set(S['root'].children)
  box('Boot',(.23,.45,.23),(side*.18,-.07,.15),'dark')
  box('Trouser',(.24,.26,.69),(side*.18,0,.58),trouser,.07)
  box('Knee pad',(.24,.09,.22),(side*.18,-.16,.52),'steel')
  pieces=set(S['root'].children)-previous
  pivot=empty('leg_left' if side<0 else 'leg_right',(side*.18,0,.95),S['root'])
  for o in pieces:o.location-=pivot.location;o.parent=pivot

def arms(upper,lower,reach=.36):
 for side in [-1,1]:
  beam((side*reach,0,1.38),(side*(reach+.04),-.3,1.13),.115,upper);beam((side*(reach+.04),-.3,1.13),(side*.15,-.55,1.27),.09,lower)

def head(cap,capmat,capscale=(.245,.24,.19)):
 sphere('Head',(0,0,1.72),(.21,.19,.25),'skin');sphere(cap,(0,.02,1.85),capscale,capmat)

def raider():
 new('raider');legs('snow')
 box('Anorak',(.68,.4,.64),(0,0,1.17),'snow',.12)
 box('Anorak hem',(.7,.42,.08),(0,0,.86),'dark',.02)
 box('Chest rig',(.52,.14,.4),(0,-.23,1.2),'dark',.05)
 for x in [-.16,.02,.2]:box('Magazine pouch',(.12,.1,.18),(x,-.32,1.1),'armor')
 box('Satchel charge',(.22,.14,.26),(-.4,-.1,.95),'canvas',.03)
 box('Rucksack',(.42,.26,.46),(0,.3,1.2),'canvas',.08)
 for side in [-1,1]:box('Ski',(.09,.04,2.0),(side*.13,.46,1.35),'wood',.01,(0,side*.18,0))
 box('Ski poles',(.03,.03,1.4),(.32,.44,1.25),'steel',0,(0,.1,0))
 head('Fur hood','canvas',(.27,.26,.2))
 box('Goggles',(.32,.1,.09),(0,-.17,1.8),'glass')
 box('Face wrap',(.3,.12,.1),(0,-.17,1.66),'snow',.02)
 arms('snow','snow')
 box('SMG receiver',(.12,.42,.14),(.08,-.5,1.3),'dark',.02)
 cyl('SMG barrel',.022,.3,(.08,-.85,1.33),'steel',(math.pi/2,0,0))
 box('Magazine',(.08,.1,.24),(.08,-.48,1.15),'dark');box('Folding stock',(.05,.22,.08),(.08,-.22,1.32),'steel')
 box('Shoulder patch',(.07,.16,.14),(-.37,-.03,1.38),'trim');box('Hood badge',(.1,.03,.06),(0,-.22,1.86),'trim',.005)

def sapper():
 new('sapper');legs('armor')
 box('Blast jacket',(.74,.44,.66),(0,0,1.17),'armor',.12)
 box('Steel breastplate',(.58,.16,.46),(0,-.25,1.22),'steel',.05)
 box('Groin plate',(.4,.12,.2),(0,-.24,.9),'steel',.03)
 box('Demolition pack',(.5,.34,.54),(0,.32,1.2),'canvas',.06)
 for x in [-.14,.14]:box('Breaching charge',(.14,.1,.3),(x,.52,1.2),'orange',.02)
 box('Entrenching tool',(.12,.05,.5),(.3,.45,1.3),'steel',.01);box('Tool handle',(.05,.05,.32),(.3,.45,1.68),'wood',.005)
 head('Blast helmet','steel',(.27,.26,.21))
 box('Visor',(.34,.08,.14),(0,-.2,1.78),'glass',.01);box('Helmet band',(.5,.3,.05),(0,.02,1.9),'trim',.01)
 arms('armor','armor',.38)
 box('Breaching shotgun',(.12,.7,.15),(.1,-.55,1.28),'dark',.02);cyl('Shotgun barrel',.03,.35,(.1,-1.05,1.32),'steel',(math.pi/2,0,0))
 box('Shell loop',(.09,.4,.12),(.1,-.5,1.2),'leather',.01)
 box('Shoulder patch',(.07,.16,.14),(-.4,-.03,1.38),'trim')

def militia():
 new('militia');legs('leather')
 box('Wool coat',(.64,.38,.66),(0,0,1.15),'leather',.1)
 box('Bandolier',(.1,.06,.72),(0,-.21,1.18),'canvas',.01,(0,.6,0))
 box('Knapsack',(.4,.26,.4),(0,.28,1.2),'canvas',.06)
 box('Lantern',(.12,.12,.18),(.36,.1,.95),'light',.02)
 head('Knitted cap','red',(.23,.22,.16))
 box('Scarf',(.44,.4,.12),(0,0,1.53),'trim',.04)
 arms('leather','leather')
 box('Hunting rifle stock',(.1,.5,.13),(.08,-.4,1.28),'wood',.02)
 cyl('Rifle barrel',.022,.75,(.08,-1.0,1.34),'steel',(math.pi/2,0,0))
 box('Shoulder patch',(.07,.16,.14),(-.36,-.03,1.38),'trim')

def marksman():
 new('marksman');legs('turf')
 box('Ghillie cloak',(.78,.5,.7),(0,.02,1.15),'turf',.2)
 for i in range(5):box('Cloak strip',(.14,.08,.42),(-.3+i*.15,-.27,.78),'turf',.03)
 box('Hood',(.4,.4,.3),(0,.03,1.92),'canvas',.1)
 sphere('Head',(0,0,1.72),(.21,.19,.25),'skin')
 box('Face wrap',(.3,.12,.12),(0,-.16,1.66),'turf',.02)
 box('Signal flare',(.06,.06,.22),(-.34,-.05,.98),'ember',.01)
 box('Spotting scope',(.08,.3,.08),(.3,.36,1.2),'dark',.01)
 arms('turf','turf',.38)
 box('Long rifle',(.1,1.2,.12),(.08,-.7,1.3),'dark',.02)
 cyl('Rifle barrel',.02,.45,(.08,-1.5,1.33),'steel',(math.pi/2,0,0))
 box('Scope',(.07,.36,.07),(.08,-.55,1.42),'glass',.01)
 for side in [-1,1]:beam((.08+side*.05,-1.2,1.24),(.08+side*.18,-1.2,.98),.02)
 box('Shoulder patch',(.07,.16,.14),(-.42,-.03,1.38),'trim')

def tracks(l,x=1.22,links=19,z=.63):
 for side in [-x,x]:
  box('Track belt',(.58,l,.92),(side,0,z),'rubber',.2)
  for i in range(6):cyl('Road wheel',.33,.64,(side,-l*.36+i*l*.144,z-.04),'steel',(0,math.pi/2,0))
  for i in range(links):
   for zz in [z-.45,z+.41]:box('Track link',(.65,.14,.06),(side,-l*.44+i*(l*.88/(links-1)),zz),'steel',0)

def snowmobile():
 new('snowmobile')
 box('Track belt',(.62,2.0,.7),(0,.75,.45),'rubber',.2)
 for i in range(4):cyl('Bogie wheel',.2,.5,(0,.15+i*.4,.4),'steel',(0,math.pi/2,0))
 for i in range(11):
  for z in [.12,.8]:box('Track lug',(.66,.1,.05),(0,-.15+i*.18,z),'steel',0)
 box('Tunnel',(.9,2.2,.3),(0,.7,.95),'armor',.08)
 for side in [-1,1]:
  box('Ski',(.24,1.5,.08),(side*.62,-1.35,.1),'steel',.02)
  box('Ski tip',(.24,.32,.08),(side*.62,-2.15,.2),'steel',.02,(-.55,0,0))
  box('Ski runner',(.05,1.2,.06),(side*.62,-1.3,.03),'dark',0)
  beam((side*.62,-1.25,.15),(side*.5,-.9,.75),.05);beam((side*.62,-1.45,.15),(side*.5,-1.2,.75),.05)
  box('Culture cowl',(.06,.9,.3),(side*.5,-.85,1.05),'trim',.01)
  box('Running board',(.22,1.2,.05),(side*.55,.35,.8),'steel',.01)
 box('Cowling',(1.0,1.7,.55),(0,-.75,.95),'snow',.12)
 box('Hood scoop',(.5,.6,.12),(0,-1.1,1.27),'dark',.02)
 box('Windscreen',(.9,.06,.45),(0,-.2,1.45),'glass',.02,(-.35,0,0))
 for x in [-.3,.3]:box('Headlight',(.2,.06,.12),(x,-1.62,1.05),'light',.02)
 box('Saddle',(.5,1.3,.22),(0,.5,1.2),'leather',.06)
 beam((-.4,-.3,1.5),(.4,-.3,1.5),.03);beam((0,-.55,1.2),(0,-.3,1.5),.035)
 cyl('Exhaust',.05,.5,(.6,-.2,.75),'steel',(0,math.pi/2,0),8)
 box('Rider torso',(.5,.34,.55),(0,.15,1.6),'snow',.1)
 sphere('Rider head',(0,.1,2.02),(.19,.18,.22),'skin');sphere('Rider helmet',(0,.12,2.1),(.22,.22,.18),'dark');box('Rider visor',(.3,.08,.08),(0,-.08,2.05),'glass')
 for side in [-1,1]:
  beam((side*.3,.1,1.75),(side*.4,-.28,1.52),.07,'snow')
  box('Rider leg',(.2,.6,.2),(side*.34,.3,1.02),'rubber',.05)
 beam((0,1.15,1.1),(0,1.15,1.9),.04)
 box('Pintle MG',(.14,.9,.16),(0,.75,1.95),'dark',.02);cyl('MG barrel',.03,.6,(0,.05,1.97),'dark',(math.pi/2,0,0),8)
 box('Ammunition box',(.2,.3,.2),(-.2,.85,1.98),'armor',.02)
 box('Gunner torso',(.5,.34,.55),(0,1.4,1.72),'snow',.1)
 sphere('Gunner head',(0,1.38,2.14),(.19,.18,.22),'skin');sphere('Gunner cap',(0,1.4,2.24),(.22,.22,.16),'dark')
 for side in [-1,1]:
  beam((side*.3,1.35,1.85),(side*.12,.95,1.95),.07,'snow')
  box('Gunner leg',(.2,.22,.5),(side*.14,1.45,1.2),'rubber',.05)
 box('Fuel can',(.3,.14,.36),(-.55,1.3,1.1),'orange',.02);box('Satchel crate',(.36,.4,.28),(.5,1.45,1.1),'canvas',.03)
 box('Pennant',(.04,.4,.3),(-.48,1.8,1.9),'trim',.01);cyl('Pennant staff',.02,1.0,(-.48,1.85,1.5),'steel',vertices=8)

def mortar():
 new('mortar');tracks(4.2,1.2,15,.63)
 box('Hull',(2.2,3.8,.7),(0,0,1.15),'armor',.2)
 box('Driver cab',(1.7,1.1,.7),(0,-1.2,1.8),'snow',.15);box('Cab glass',(1.3,.06,.28),(0,-1.76,1.9),'glass',.02)
 box('Base plate',(1.5,1.5,.25),(0,.7,1.6),'steel',.05)
 cyl('Siege mortar tube',.24,2.6,(0,.05,2.7),'dark',(.62,0,0),16)
 cyl('Muzzle ring',.3,.2,(0,-.68,3.75),'steel',(.62,0,0),16)
 for side in [-1,1]:
  beam((side*.6,.9,1.75),(side*.35,-.3,3.0),.07)
  box('Recoil spade',(.5,.9,.16),(side*.75,2.3,.45),'steel',.02,(-.6,0,0))
  box('Culture marking',(.05,1.2,.2),(side*1.12,-.3,1.42),'trim',.01)
  box('Shell rack',(.3,1.2,.4),(side*.9,1.2,1.7),'armor',.03)
  for i in range(3):cyl('Mortar bomb',.09,.5,(side*.9,.8+i*.4,1.98),'orange',vertices=10)
 box('Winter plate',(1.6,.6,.08),(0,-.6,1.55),'snow')
 for i in range(4):box('Engine vent',(1.2,.05,.04),(0,1.7+i*.12,1.5),'dark',.005)
 box('Fire-control mast',(.08,.08,1.4),(-.8,-.4,2.6),'steel',.005);box('Rangefinder',(.4,.15,.25),(-.8,-.4,3.35),'trim',.03)
 for x in [-.7,.7]:box('Headlight',(.25,.06,.13),(x,-1.95,1.3),'light',.02)

def bulwark():
 new('bulwark')
 for side in [-1,1]:
  cyl('Rear tire',.78,.55,(side*1.15,1.0,.78),'rubber',(0,math.pi/2,0),22);cyl('Rear rim',.42,.58,(side*1.15,1.0,.78),'steel',(0,math.pi/2,0));cyl('Rear hub',.12,.61,(side*1.15,1.0,.78),'armor',(0,math.pi/2,0))
  cyl('Front tire',.5,.42,(side*1.0,-1.25,.5),'rubber',(0,math.pi/2,0),18);cyl('Front rim',.27,.45,(side*1.0,-1.25,.5),'steel',(0,math.pi/2,0));cyl('Front hub',.1,.48,(side*1.0,-1.25,.5),'armor',(0,math.pi/2,0))
  box('Mud guard',(.7,1.9,.12),(side*1.15,1.0,1.62),'armor',.02)
  box('Culture panel',(.06,1.3,.4),(side*1.0,.3,1.45),'trim',.01)
  box('Push arm',(.16,1.6,.16),(side*.9,-1.6,.95),'steel',.01)
 box('Chassis',(1.8,3.4,.7),(0,0,1.15),'armor',.15)
 box('Engine hood',(1.4,1.4,.6),(0,-.85,1.7),'snow',.12)
 for i in range(5):box('Radiator grille',(1.0,.05,.05),(0,-1.58,1.5+i*.09),'dark',.005)
 box('Armored cab',(1.7,1.3,1.1),(0,.55,2.05),'armor',.15)
 box('Cab slit',(1.3,.06,.16),(0,-.12,2.3),'glass',.01)
 for side in [-1,1]:box('Side slit',(.05,.5,.16),(side*.86,.5,2.3),'glass',.01)
 for i in range(4):box('Sandbag',(.5,.3,.24),(-.75+i*.5,1.2,2.72),'wood',.03)
 cyl('Exhaust stack',.08,1.0,(.6,-.3,2.5),'steel',vertices=10)
 box('Dozer blade',(2.9,.3,1.2),(0,-2.45,.8),'steel',.04,(.12,0,0))
 for i in range(3):box('Hazard stripe',(2.6,.04,.14),(0,-2.63,.5+i*.32),'gold',.005,(.12,0,0))
 box('Blade top edge',(2.9,.36,.12),(0,-2.38,1.42),'trim',.02)
 box('Remote MG',(.4,.6,.25),(0,.7,2.72),'dark',.04);cyl('MG barrel',.035,.8,(0,.15,2.76),'dark',(math.pi/2,0,0),8)
 for x in [-.5,.5]:box('Headlight',(.22,.06,.12),(x,-1.57,1.95),'light',.02)

def fenrir():
 new('fenrir')
 for side in [-1,1]:
  for y in [-1.3,1.3]:
   cyl('All terrain tire',.52,.4,(side*1.05,y,.52),'rubber',(0,math.pi/2,0),20);cyl('Wheel rim',.3,.43,(side*1.05,y,.52),'steel',(0,math.pi/2,0));cyl('Hub',.1,.46,(side*1.05,y,.52),'armor',(0,math.pi/2,0))
  box('Door panel',(.06,1.0,.5),(side*.96,.1,1.05),'trim',.01)
  box('Running board',(.3,1.6,.06),(side*1.0,0,.6),'steel',.01)
 box('Body tub',(1.9,3.5,.7),(0,0,1.0),'armor',.18)
 box('Bonnet',(1.6,1.2,.45),(0,-1.2,1.45),'snow',.1)
 box('Windscreen',(1.4,.06,.5),(0,-.55,1.7),'glass',.02,(-.3,0,0))
 for side in [-1,1]:
  beam((side*.8,-.5,1.3),(side*.75,-.3,2.25),.04);beam((side*.8,1.2,1.3),(side*.75,1.0,2.25),.04);beam((side*.75,-.3,2.25),(side*.75,1.0,2.25),.04)
 beam((-.75,-.3,2.25),(.75,-.3,2.25),.04);beam((-.75,1.0,2.25),(.75,1.0,2.25),.04)
 box('Seats',(1.3,.9,.5),(0,.3,1.45),'leather',.06)
 cyl('Sensor mast',.05,1.4,(-.5,.9,2.5),'steel',vertices=8)
 box('Optics head',(.5,.32,.28),(-.5,.9,3.3),'trim',.04);box('Lens',(.2,.08,.14),(-.5,.7,3.3),'glass',.01)
 box('Flare launcher',(.5,.4,.3),(.5,1.0,2.4),'dark',.04)
 for i in range(4):cyl('Flare tube',.05,.2,(.35+(i%2)*.3,1.0,2.35+(i//2)*.14),'ember',(math.pi/2,0,0),8)
 cyl('Spare tire',.5,.3,(0,1.9,1.3),'rubber',(math.pi/2,0,0),20)
 for x in [-.55,.55]:box('Headlight',(.24,.06,.13),(x,-1.78,1.4),'light',.02)
 for x in [-.7,.7]:box('Jerrycan',(.3,.12,.42),(x,1.72,1.55),'orange',.02)
 box('Winch',(.7,.25,.25),(0,-1.85,1.05),'steel',.03)

def camp():
 new('camp')
 box('Gravel pad',(7.2,7.0,.2),(0,0,.1),'stone',.06)
 box('Snow drift',(1.6,1.0,.14),(-2.4,2.6,.27),'snow',.06)
 box('Lodge footing',(4.8,3.4,.3),(0,1.5,.35),'concrete',.05)
 box('Tarred lodge',(4.6,3.2,2.3),(0,1.5,1.6),'tar',.05)
 for side in [-1,1]:
  for i in range(9):box('Board seam',(.06,.05,2.2),(side*2.32,.15+i*.35,1.6),'wood',0)
  for y in [-.05,3.05]:box('Corner post',(.16,.16,2.6),(side*2.3,y,1.65),'wood',.01)
 pitched(4.6,3.2,1.5,2.75,1.15,'steel')
 for y in [-.05,3.05]:gable(y,4.6,2.75,3.9,'tar')
 box('Door',(1.0,.1,1.8),(0,-.14,1.4),'red',.02)
 for x in [-1.4,1.4]:box('Window',(.7,.1,.5),(x,-.14,2.1),'glass',.01)
 box('Faction board',(1.4,.1,.5),(0,-.16,3.1),'trim',.02)
 cyl('Stove pipe',.12,1.0,(1.2,2.2,4.1),'steel',vertices=8);cyl('Pipe cap',.18,.06,(1.2,2.2,4.63),'dark',vertices=8)
 for i in range(3):
  for j in range(3-i):cyl('Firewood',.13,.9,(-2.62-j*.28+i*.14,.9,.33+i*.24),'wood',(math.pi/2,0,0),10)
 for i in range(5):box('Racked ski',(.09,.05,1.9),(2.72,.7+i*.35,.95),'wood',.01,(0,-.25,0))
 box('Ski rack rail',(.5,1.7,.08),(2.75,1.4,1.3),'wood',.01)
 mesh('Ridge tent',[(-3.4,-2.7,.2),(-1.2,-2.7,.2),(-2.3,-2.7,1.6),(-3.4,-.5,.2),(-1.2,-.5,.2),(-2.3,-.5,1.6)],[(0,1,2),(3,4,5),(0,2,5,3),(1,2,5,4)],'canvas')
 cyl('Tent pole',.04,1.5,(-2.3,-2.66,.95),'wood',vertices=8);cyl('Tent pole',.04,1.5,(-2.3,-.54,.95),'wood',vertices=8)
 box('Tent flap',(.06,.7,1.0),(-2.3,-2.72,.7),'trim',.01,(0,0,0))
 cyl('Fire ring',.55,.25,(1.4,-1.7,.32),'stone',vertices=12);sphere('Camp fire',(1.4,-1.7,.5),(.32,.32,.26),'ember')
 for i in range(3):box('Fire log',(.16,.7,.16),(1.4,-1.7,.42),'wood',.02,(0,0,i*1.05))
 box('Log seat',(.3,1.3,.3),(.4,-1.7,.35),'wood',.03)
 box('Log seat',(1.3,.3,.3),(1.4,-2.8,.35),'wood',.03)
 box('Rack frame',(1.4,.12,1.3),(-1.3,-.6,.85),'wood',.02)
 for i in range(4):box('Racked rifle',(.06,.08,1.1),(-1.75+i*.3,-.68,.85),'dark',.005)
 for x,y in [(1.7,-2.6),(3.5,-2.6),(1.7,-.2),(3.5,-.2)]:cyl('Lean-to post',.06,1.9,(x,y,1.05),'wood',vertices=8)
 box('Lean-to roof',(2.1,2.7,.08),(2.6,-1.4,2.05),'tar',.01,(0,.12,0))
 box('Cargo sled',(.9,1.6,.3),(2.9,-1.0,.4),'wood',.02)
 for side in [-1,1]:box('Sled runner',(.08,1.8,.1),(2.9+side*.4,-1.0,.25),'steel',.01)
 cyl('Fuel drum',.3,.75,(2.1,-2.0,.6),'red',vertices=12);cyl('Fuel drum',.3,.75,(2.1,-1.3,.6),'red',vertices=12)
 for i in range(4):box('Sandbag',(.55,.3,.26),(-.9+i*.5,-3.2,.33),'canvas',.03)
 cyl('Flagpole',.05,4.6,(-2.9,2.6,2.5),'steel');box('Pennant',(.06,.9,.55),(-2.9,3.0,4.4),'trim',.01)
 for x in [-1.6,1.6]:box('Floodlight',(.4,.2,.12),(x,-.2,2.9),'light')

def armory():
 new('armory')
 box('Casemate apron',(6.4,6.4,.5),(0,0,.25),'concrete',.3)
 box('Bunker',(5.0,4.6,2.3),(0,.3,1.6),'concrete',.35)
 for side in [-1,1]:
  box('Rock berm',(1.3,4.8,.4),(side*2.85,.3,.85),'stone',.1,(0,side*-.5,0))
  box('Culture panel',(.08,1.8,.6),(side*2.53,.6,2.0),'trim',.01)
  for i in range(2):box('Gun slit',(.1,.5,.16),(side*2.52,-1.0+i*.9,2.35),'dark',.01)
 box('Blast door',(2.4,.24,2.0),(0,-2.05,1.5),'steel',.03)
 for i in range(3):box('Door stripe',(.2,.06,1.6),(-.7+i*.7,-2.2,1.5),'trim',.005)
 box('Warning band',(2.4,.06,.12),(0,-2.2,2.42),'gold',.005)
 box('Door lintel',(3.0,.5,.4),(0,-2.05,2.7),'concrete',.05)
 box('Roof slab',(5.4,5.0,.36),(0,.3,2.93),'armor',.08)
 box('Snow patch',(2.0,1.5,.08),(-1.2,1.0,3.15),'snow')
 for i in range(8):
  a=i*math.pi/4;box('Sandbag',(.6,.32,.28),(math.cos(a)*1.9,.3+math.sin(a)*1.9,3.25),'wood',.03,(0,0,a))
 box('Observation cupola',(1.4,1.4,.8),(-1.3,.6,3.5),'armor',.2);box('Vision slit',(1.0,.06,.14),(-1.3,-.12,3.6),'dark',.01)
 cyl('Forge stack',.32,2.2,(1.6,1.3,4.1),'steel');cyl('Stack cap',.42,.1,(1.6,1.3,5.25),'dark');box('Ember glow',(.3,.3,.1),(1.6,1.3,5.32),'ember',.01)
 box('Forge',(1.2,.9,.9),(2.4,-1.6,.95),'steel',.05);box('Forge mouth',(.7,.06,.4),(2.4,-2.07,1.0),'ember',.01)
 box('Anvil',(.6,.25,.3),(2.5,-.6,.9),'dark',.03);cyl('Anvil stand',.2,.4,(2.5,-.6,.7),'wood',vertices=8)
 for i in range(3):box('Shell crate',(.8,.5,.4),(-2.3,-1.8+i*.55,.7),'wood',.02)
 cyl('Mast',.05,3.2,(-2.6,2.3,2.1),'steel');box('Pennant',(.06,.8,.5),(-2.6,2.7,3.4),'trim',.01)
 for x in [-1.7,1.7]:box('Floodlight',(.4,.2,.12),(x,-2.35,2.5),'light')

def depot():
 new('depot')
 box('Stone footing',(5.0,4.2,.2),(0,.2,.1),'concrete',.04)
 for x in [-1.9,0,1.9]:
  for y in [-1.2,1.8]:cyl('Stave post',.17,1.0,(x,y,.5),'wood',vertices=10);box('Rat guard',(.6,.6,.08),(x,y,.98),'stone',.01)
 box('Floor deck',(4.6,3.9,.2),(0,.3,1.1),'wood',.03)
 box('Storehouse',(4.2,3.4,2.2),(0,.4,2.3),'red',.05)
 for z in [1.55,1.95,2.35,2.75,3.15]:
  for side in [-1,1]:
   box('Log course',(.1,3.5,.2),(side*2.12,.4,z),'wood',.03)
   box('Log end',(4.3,.1,.2),(0,.4+side*1.72,z),'wood',.03)
 angle=math.atan2(1.3,2.1)
 for side in [-1,1]:
  box('Turf roof',(math.hypot(2.1,1.3)+.5,4.6,.22),(side*1.05,.4,4.05),'turf',.04,(0,side*angle,0))
  box('Birch bark edge',(math.hypot(2.1,1.3)+.5,4.65,.06),(side*1.05,.4,3.91),'snow',.01,(0,side*angle,0))
 box('Ridge log',(.22,4.7,.2),(0,.4,4.78),'wood',.03)
 for y in [-1.32,2.12]:gable(y,4.2,3.4,4.7,'red')
 box('Gallery',(4.6,.9,.14),(0,-1.75,1.1),'wood',.02)
 for x in [-2.2,-1.1,1.1,2.2]:box('Rail post',(.1,.1,.9),(x,-2.15,1.6),'wood',.01)
 box('Hand rail',(4.6,.08,.08),(0,-2.15,2.05),'wood',.01)
 box('Door',(1.1,.1,1.8),(0,-1.36,2.1),'trim',.02)
 for x in [-1.3,1.3]:box('Window',(.7,.1,.6),(x,-1.36,2.5),'glass',.01);box('Shutter',(.3,.08,.65),(x+.55,-1.38,2.5),'trim',.01)
 for i in range(4):box('Step',(1.3,.35,.2),(0,-2.35-i*.3,1.0-i*.25),'wood',.02)
 box('Hoist beam',(.18,1.6,.18),(0,-2.3,4.5),'wood',.02)
 beam((0,-3.0,4.42),(0,-3.0,3.1),.02,'rope');box('Hoisted crate',(.7,.7,.6),(0,-3.0,2.8),'wood',.03)
 cyl('Chimney',.22,1.2,(1.2,.9,4.4),'stone',vertices=10)
 for i in range(4):sphere('Grain sack',(-2.9,-.9+i*.55,.35),(.3,.26,.28),'canvas')
 for i in range(3):cyl('Barrel',.3,.7,(2.95,-1.0+i*.7,.55),'wood',vertices=12)
 for i in range(2):box('Hay bale',(.9,.6,.5),(2.9,1.6,.45+i*.5),'gold',.03)
 box('Ore cart',(.9,1.3,.5),(-2.9,1.6,.7),'steel',.03)
 for y in [1.2,2.0]:cyl('Cart wheel',.22,.1,(-2.9,y,.3),'dark',(0,math.pi/2,0),12)
 cyl('Flagpole',.05,4.6,(2.6,2.4,2.3),'steel');box('Banner',(.06,.9,.6),(2.6,2.85,4.25),'trim',.01)

def leg(sx,sy,z):
 return (sx*(1.6-.65*(z-.2)/6.0),sy*(1.6-.65*(z-.2)/6.0),z)

def watchtower():
 new('watchtower')
 box('Cairn footing',(3.6,3.6,.3),(0,0,.15),'stone',.15)
 for i in range(10):
  a=i*math.pi/5;r=1.2 if i%2 else .9
  box('Cairn stone',(.9,.6,.5),(math.cos(a)*r,math.sin(a)*r,.5+(.1 if i%2 else .25)),'stone',.12,(0,0,a))
 box('Cairn cap',(1.2,1.2,.5),(0,0,1.0),'stone',.2)
 for sx in [-1,1]:
  for sy in [-1,1]:beam(leg(sx,sy,.2),leg(sx,sy,6.2),.11,'wood')
 for z0,z1 in [(1.2,3.2),(3.2,5.2)]:
  for s in [-1,1]:
   beam(leg(s,-1,z0),leg(s,1,z1),.045,'wood');beam(leg(s,1,z0),leg(s,-1,z1),.045,'wood')
   beam(leg(-1,s,z0),leg(1,s,z1),.045,'wood');beam(leg(1,s,z0),leg(-1,s,z1),.045,'wood')
  for s in [-1,1]:
   beam(leg(s,-1,z1),leg(s,1,z1),.05,'wood');beam(leg(-1,s,z1),leg(1,s,z1),.05,'wood')
 box('Deck',(3.2,3.2,.16),(0,0,6.28),'wood',.03)
 for sx in [-1,1]:
  for sy in [-1,1]:box('Rail post',(.1,.1,1.0),(sx*1.5,sy*1.5,6.85),'wood',.01)
 for side in [-1,1]:
  box('Rail',(3.1,.08,.08),(0,side*1.5,7.3),'wood',.01);box('Rail',(.08,3.1,.08),(side*1.5,0,7.3),'wood',.01)
 box('Lookout cabin',(2.3,2.3,1.5),(0,0,7.1),'wood',.04)
 for side in [-1,1]:
  box('Window band',(2.0,.08,.5),(0,side*1.16,7.4),'glass',.01)
  box('Window band',(.08,2.0,.5),(side*1.16,0,7.4),'glass',.01)
 for sx in [-1,1]:
  for sy in [-1,1]:box('Corner board',(.12,.12,1.55),(sx*1.15,sy*1.15,7.1),'trim',.01)
 mesh('Pyramid roof',[(-1.55,-1.55,7.85),(1.55,-1.55,7.85),(1.55,1.55,7.85),(-1.55,1.55,7.85),(0,0,8.6)],[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,1,2,3)],'steel')
 cyl('Brazier',.32,.3,(1.5,-1.5,7.5),'dark',vertices=12);sphere('Beacon fire',(1.5,-1.5,7.72),(.24,.24,.2),'ember')
 for side in [-1,1]:beam((side*.3,-1.72,.3),(side*.3,-1.06,6.2),.04,'wood')
 for i in range(10):
  z=1.0+i*.52;box('Rung',(.7,.06,.06),(0,-1.72+.66*(z-.3)/5.9,z),'wood',0)
 box('Radio hut',(1.4,1.0,1.1),(2.1,1.6,.55),'armor',.04);cyl('Antenna',.03,2.2,(2.4,1.8,2.2),'steel',vertices=8)
 box('Hut door',(.5,.06,.8),(2.1,1.08,.5),'dark',.01)
 for i in range(3):box('Sandbag',(.55,.3,.26),(-2.2+i*.5,-2.0,.41),'wood',.03)
 box('Signal panel',(.06,.9,.5),(2.82,1.6,.7),'trim',.01)

raider();sapper();militia();marksman();snowmobile();mortar();bulwark();fenrir();camp();armory();depot();watchtower()
# Join geometry by material to keep browser draw calls bounded.
for root in allroots:
 for o in list(root.children_recursive):
  if o.type=='MESH':
   bpy.context.view_layer.objects.active=o
   for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
 for mat in M.values():
  group=[o for o in list(root.children) if o.type=='MESH' and mat in list(o.data.materials)]
  if len(group)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in group:o.select_set(True)
   bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
   group[0].name=root.name+'_'+mat.name
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/factions.blend'))
for root in allroots:
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 bpy.context.view_layer.objects.active=root
 bpy.ops.export_scene.gltf(filepath=str(OUT/(root.name+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
# Portraits render from the same authored models.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=256;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
if scene.world is None:scene.world=bpy.data.worlds.new('Portrait world')
scene.world.color=(.35,.35,.35)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
for p,energy,size in [((5,-7,10),1600,7),((-6,-1,6),1000,6)]:
 bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
SIZE={'camp':9,'armory':9,'depot':9,'watchtower':10.5,'snowmobile':5,'mortar':6,'bulwark':6,'fenrir':5.5,'raider':2.8,'sapper':2.8,'militia':2.8,'marksman':2.8}
TARGET={'camp':1.8,'armory':1.8,'depot':2.2,'watchtower':4.2}
for root in allroots:
 for other in allroots:
  for o in other.children_recursive:o.hide_render=other!=root
 size=SIZE[root.name];target=Vector((0,0,TARGET.get(root.name,1)))
 camera.location=target+Vector((size,-size*1.35,size*.95));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.35
 scene.render.filepath=str(ROOT/'public/art/tactical'/(root.name+'.png'));bpy.ops.render.render(write_still=True)
for root in allroots:
 for o in root.children_recursive:o.hide_render=False
print('Faction equipment complete: %d signature assets and portraits.'%len(allroots))
