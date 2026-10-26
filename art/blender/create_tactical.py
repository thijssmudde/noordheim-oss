"""Author original Scandinavian field equipment, export GLB, and render UI portraits.
Blender is the editable source; no third-party game artwork is used.
"""
import bpy, math, random
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/tactical'; OUT.mkdir(parents=True,exist_ok=True)
ICONS=ROOT/'public/art/tactical'; ICONS.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
M={}
colors={'armor':'697976','snow':'c2c9bf','dark':'202c30','rubber':'161e21','steel':'46575e','trim':'4299b6','glass':'163e50','light':'c0f3f4','red':'78433b','wood':'78644e','concrete':'8d9892','gold':'c8ab64','skin':'b79b80','orange':'d57e43'}
for key,h in colors.items():
 linear=lambda c:c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
 m=bpy.data.materials.new('culture_trim' if key=='trim' else key);m.diffuse_color=tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))+(1,);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.7 if key in ['wood','concrete','rubber'] else .4
 if key in ['steel','armor']:p.inputs['Metallic'].default_value=.45
 if key in ['light','trim']:p.inputs['Emission Color'].default_value=m.diffuse_color;p.inputs['Emission Strength'].default_value=.7 if key=='light' else .12
 M[key]=m
root=None
allroots=[]
def own(o,name,mat):
 o.name=name;o.parent=root;o.data.materials.append(M[mat]);return o

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

def new(name):
 global root
 root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root);root['tactical_kind']=name;allroots.append(root)

def details(w,l,h):
 for x in [-w/2,w/2]:
  box('Culture marking',(.05,l*.5,.15),(x,0,h),'trim',.01)
  for y in [-l*.25,l*.25]:cyl('Bolt',.045,.03,(x,y,h+.17),'steel',(0,math.pi/2,0),8)
 for x in [-w*.32,w*.32]:box('Headlight',(.23,.06,.13),(x,-l*.5-.025,h),'light',.02)
 beam((w*.35,l*.3,h),(w*.35,l*.3,h+1.3),.014)
 for i in range(6):box('Engine vent',(w*.55,.05,.04),(0,l*.1+i*.13,h+.26),'dark',.005)
 for side in [-1,1]:
  box('Tow hook',(.18,.2,.12),(side*w*.32,l*.5,h-.15),'steel')
  box('Stowed equipment',(.3,.6,.24),(side*w*.34,l*.29,h+.2),'armor')

def tank():
 new('tank')
 for x in [-1.22,1.22]:
  box('Track belt',(.58,4.4,.92),(x,0,.63),'rubber',.2)
  for y in [-1.55,-.92,-.3,.3,.92,1.55]:
   cyl('Road wheel',.35,.64,(x,y,.59),'steel',(0,math.pi/2,0));cyl('Wheel hub',.14,.67,(x,y,.59),'armor',(0,math.pi/2,0))
  for i in range(19):
   for z in [.18,1.04]:box('Track link',(.65,.15,.06),(x,-1.95+i*.217,z),'steel',.006)
  for y in [-2.1,2.1]:
   for i in range(4):box('Track return',(.64,.065,.15),(x,y,.35+i*.18),'steel',.005)
 box('Sloped glacis',(2.3,3.9,.7),(0,0,1.16),'armor',.23)
 box('Snow camouflage',(1.7,1.35,.08),(-.1,-1,1.53),'snow')
 for x in [-1.28,1.28]:
  for y in [-1.55,-.75,.05,.85,1.55]:box('Side armor',(.18,.7,.65),(x,y,1.18),'snow' if y<0 else 'armor',.03)
 box('Turret',(1.9,2,.65),(0,-.15,1.94),'armor',.27)
 box('Turret winter plate',(1.6,.65,.1),(0,-.65,2.29),'snow',.06)
 cyl('Gun mantlet',.23,.7,(0,-1.25,1.98),'armor',(math.pi/2,0,0))
 cyl('120mm barrel',.085,2.5,(0,-2.8,1.98),'steel',(math.pi/2,0,0))
 cyl('Muzzle',.14,.22,(0,-4.05,1.98),'dark',(math.pi/2,0,0))
 cyl('Commander hatch',.32,.1,(-.35,.2,2.31),'steel');box('Optics',(.35,.35,.28),(.45,-.4,2.4),'glass')
 for side in [-1,1]:
  for i in range(4):cyl('Smoke launcher',.06,.23,(side*.83,-.8+i*.16,2.15),'dark',(.9,0,0))
 details(2.55,3.8,1.25)

def lynx():
 new('lynx')
 box('Armored hull',(2.05,3.8,.85),(0,0,1.05),'armor',.22)
 box('Cabin',(1.8,2.35,.72),(0,-.35,1.68),'snow',.18)
 box('Front glass',(1.5,.07,.38),(0,-1.57,1.85),'glass',.03,(-.18,0,0))
 for side in [-1,1]:
  for y in [-1.22,0,1.22]:
   cyl('All terrain tire',.49,.42,(side*1.05,y,.58),'rubber',(0,math.pi/2,0),20)
   cyl('Wheel rim',.28,.45,(side*1.05,y,.58),'steel',(0,math.pi/2,0))
   cyl('Central hub',.1,.48,(side*1.05,y,.58),'armor',(0,math.pi/2,0))
  for y in [-.9,-.25,.4]:box('Side glazing',(.04,.45,.3),(side*.91,y,1.82),'glass',.01)
 box('Remote weapon',(.6,.85,.32),(0,.3,2.24),'armor',.06)
 cyl('Autocannon',.055,1.4,(0,-.65,2.28),'dark',(math.pi/2,0,0))
 details(2.1,3.8,1.15)

def infantry(kind,rocket=False):
 new(kind)
 for side in [-1,1]:
  previous=set(root.children)
  box('Boot',(.23,.45,.23),(side*.18,-.07,.15),'dark')
  box('Trouser',(.24,.26,.69),(side*.18,0,.58),'armor',.07)
  box('Knee pad',(.24,.09,.22),(side*.18,-.16,.52),'steel')
  pieces=set(root.children)-previous
  pivot=bpy.data.objects.new('leg_left' if side<0 else 'leg_right',None);bpy.context.collection.objects.link(pivot);pivot.parent=root;pivot.location=(side*.18,0,.95)
  for o in pieces:o.location-=pivot.location;o.parent=pivot
 box('Winter jacket',(.68,.4,.64),(0,0,1.17),'snow' if not rocket else 'armor',.12)
 box('Plate carrier',(.55,.15,.43),(0,-.23,1.22),'armor' if not rocket else 'snow',.05)
 for x in [-.18,0,.18]:box('Magazine pouch',(.13,.1,.2),(x,-.33,1.08),'dark')
 box('Pack',(.47,.3,.51),(0,.3,1.18),'armor',.06)
 sphere('Head',(0,0,1.72),(.21,.19,.25),'skin');sphere('Helmet',(0,.02,1.85),(.245,.24,.19),'snow')
 box('Goggles',(.32,.1,.1),(0,-.18,1.77),'glass' if not rocket else 'trim')
 for side in [-1,1]:
  beam((side*.36,0,1.38),(side*.4,-.3,1.13),.12,'snow');beam((side*.4,-.3,1.13),(side*.15,-.55,1.27),.09,'armor')
 if rocket:
  # Shoulder-fired anti-armor launcher with two spare rounds on the pack.
  cyl('Launcher tube',.1,1.25,(.3,-.15,1.66),'dark',(math.pi/2,0,0),12)
  cyl('Launcher muzzle',.13,.12,(.3,-.82,1.66),'orange',(math.pi/2,0,0),12)
  box('Launcher grip',(.08,.14,.2),(.3,-.2,1.5),'steel')
  box('Optical sight',(.1,.3,.12),(.3,-.1,1.83),'glass',.01)
  for x in [-.12,.06]:cyl('Spare rocket',.055,.7,(x,.48,1.28),'orange',vertices=10)
  box('Shoulder patch',(.07,.16,.14),(-.37,-.03,1.38),'trim')
 else:
  box('Rifle receiver',(.14,.75,.16),(.08,-.57,1.3),'dark',.025)
  cyl('Rifle barrel',.025,.5,(.08,-1.15,1.34),'steel',(math.pi/2,0,0))
  box('Magazine',(.09,.18,.22),(.08,-.57,1.16),'dark');box('Shoulder patch',(.07,.16,.14),(-.37,-.03,1.38),'trim')

def ranger():infantry('ranger')
def rocket():infantry('rocket',True)

def drone():
 new('drone')
 box('Fuselage',(.75,1.4,.42),(0,0,.7),'snow',.15)
 sphere('Sensor',(0,-.5,.43),(.22,.24,.21),'glass')
 for x in [-1.1,1.1]:
  for y in [-.9,.9]:
   beam((x*.2,y*.3,.7),(x,y,.8),.08,'steel');cyl('Motor',.17,.19,(x,y,.86),'dark')
   blade=box('Rotor blade',(1.4,.12,.035),(x,y,1.02),'dark',.02)
   pivot=bpy.data.objects.new('rotor_pivot',None);bpy.context.collection.objects.link(pivot);pivot.parent=root;pivot.location=(x,y,1.02);blade.location-=pivot.location;blade.parent=pivot
   box('Landing skid',(.07,.75,.07),(x*.55,y*.4,.15),'steel');beam((x*.5,y*.3,.15),(x*.35,y*.3,.65),.035)
 box('Culture stripe',(.3,1.1,.03),(0,0,.92),'trim')


def harvester():
 new('harvester')
 box('Chassis',(2.1,4.6,.5),(0,.1,.85),'armor',.1)
 for side in [-1,1]:
  for y in [-1.5,0,1.5]:
   cyl('Ore tire',.55,.5,(side*1.1,y,.6),'rubber',(0,math.pi/2,0),20)
   cyl('Wheel rim',.3,.53,(side*1.1,y,.6),'steel',(0,math.pi/2,0))
   cyl('Central hub',.1,.56,(side*1.1,y,.6),'armor',(0,math.pi/2,0))
  box('Culture panel',(.06,1.7,.55),(side*1.12,.7,1.9),'trim',.01)
  box('Mud guard',(.62,1.1,.1),(side*1.1,-1.5,1.22),'armor',.02)
 box('Cab',(1.9,1.45,1.1),(0,-1.5,1.72),'red',.15)
 box('Cab glass',(1.5,.07,.5),(0,-2.21,1.92),'glass',.02,(-.2,0,0))
 for x in [-.7,.7]:box('Headlight',(.25,.06,.14),(x,-2.25,1.35),'light',.02)
 # A real open bin. The old solid cube and lining shared a top face and flickered.
 box('Hopper floor',(2.2,2.6,.18),(0,.7,1.34),'snow',.04)
 box('Hopper lining',(1.86,2.24,.05),(0,.7,1.455),'dark',.01)
 for side in [-1,1]:
  box('Hopper side',(.15,2.6,1.2),(side*1.025,.7,1.96),'snow',.035)
  box('Hopper end',(1.9,.15,1.2),(0,.7+side*1.225,1.96),'snow',.035)
  for i in range(3):box('Exterior hopper rib',(.065,.1,1.12),(side*1.125,-.4+i*1.1,1.93),'steel',.01)
 # A separate, named mesh rises from the bin floor as the authoritative cargo fills.
 ore=bpy.data.materials.new('harvester_ore');ore.use_nodes=True
 bsdf=ore.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Roughness'].default_value=.88;bsdf.inputs['Metallic'].default_value=.12
 colour=ore.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Ore'
 ore.node_tree.links.new(colour.outputs['Color'],bsdf.inputs['Base Color'])
 rng=random.Random(372);verts=[];faces=[];nx,ny=8,10
 for j in range(ny+1):
  for i in range(nx+1):
   x=(i/nx*2-1)*.9;y=(j/ny*2-1)*1.08
   edge=max(abs(x)/.9,abs(y)/1.08)
   z=.72+(1-edge)*.37+rng.uniform(-.09,.09)
   verts.append((x,y,z))
 for j in range(ny):
  for i in range(nx):
   a=j*(nx+1)+i;b=a+1;c=a+nx+1;d=c+1
   faces.extend(((a,b,d),(a,d,c)))
 # Close the pile underneath, avoiding a floating sheet when viewed from the side.
 rim=list(range(nx+1))+[j*(nx+1)+nx for j in range(1,ny+1)]+[ny*(nx+1)+i for i in range(nx-1,-1,-1)]+[j*(nx+1) for j in range(ny-1,0,-1)]
 bottom=len(verts);verts.extend((verts[i][0],verts[i][1],0) for i in rim)
 for i,a in enumerate(rim):
  k=(i+1)%len(rim);faces.append((a,bottom+i,bottom+k,rim[k]))
 faces.append(tuple(reversed(range(bottom,bottom+len(rim)))))
 mesh=bpy.data.meshes.new('Ironstone load');mesh.from_pydata(verts,[],faces);mesh.update();mesh.materials.append(ore)
 cargo=bpy.data.objects.new('cargo_fill',mesh);bpy.context.collection.objects.link(cargo);cargo.parent=root;cargo.location=(0,.7,1.48)
 attr=mesh.color_attributes.new(name='Ore',type='BYTE_COLOR',domain='CORNER')
 linear=lambda c:c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
 palette=['5b6058','747368','a17a4f','8c704f','b29662']
 for poly in mesh.polygons:
  h=rng.choice(palette);paint=tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))+(1,)
  for i in poly.loop_indices:attr.data[i].color=paint
 box('Drill boom',(.35,1.5,.3),(0,-2.85,1.45),'steel',.03,(.5,0,0))
 cyl('Drill head',.24,.8,(0,-3.35,1.05),'dark',(math.pi/2-.5,0,0),12)
 cyl('Drill tip',.1,.3,(0,-3.7,.85),'steel',(math.pi/2-.5,0,0),8)
 box('Warning stripe',(2.25,.1,.25),(0,2.05,1.5),'orange',.01)
 box('Beacon',(.2,.2,.18),(0,-1.5,2.36),'orange')
 cyl('Exhaust',.07,.9,(-.9,-.6,2.3),'steel')

def tracks(l,x=1.22,links=19,z=.63):
 for side in [-x,x]:
  box('Track belt',(.58,l,.92),(side,0,z),'rubber',.2)
  for i in range(6):cyl('Road wheel',.33,.64,(side,-l*.36+i*l*.144,z-.04),'steel',(0,math.pi/2,0))
  for i in range(links):
   for zz in [z-.45,z+.41]:box('Track link',(.65,.14,.06),(side,-l*.44+i*(l*.88/(links-1)),zz),'steel',0)

def howitzer():
 new('howitzer')
 tracks(4.1,1.15,15)
 box('Hull',(2.2,3.7,.6),(0,0,1.15),'armor',.2)
 box('Crew cabin',(1.7,1.25,.7),(0,-1.05,1.75),'snow',.15)
 box('Cabin glass',(1.3,.06,.3),(0,-1.68,1.85),'glass',.02)
 box('Gun cradle',(1,1.5,.55),(0,.65,1.72),'armor',.08)
 cyl('Trunnion',.28,1.1,(0,.2,1.85),'steel',(0,math.pi/2,0))
 cyl('155mm howitzer',.1,3.4,(0,-.94,2.47),'dark',(math.pi/2-.45,0,0))
 cyl('Muzzle brake',.16,.3,(0,-2.36,3.13),'steel',(math.pi/2-.45,0,0))
 for side in [-1,1]:
  box('Recoil spade',(.5,.9,.16),(side*.75,2.25,.45),'steel',.02,(-.6,0,0))
  box('Ammunition rack',(.28,1.4,.4),(side*.95,.5,1.62),'armor',.03)
  box('Culture marking',(.05,1.1,.18),(side*1.12,-.2,1.42),'trim',.01)
 for i in range(5):box('Engine vent',(1.2,.05,.04),(0,1.3+i*.12,1.5),'dark',.005)
 box('Fire-control mast',(.08,.08,1.2),(-.7,-.5,2.6),'steel',.005);box('Radar',(.4,.15,.3),(-.7,-.5,3.25),'trim',.03)

def jotun():
 new('jotun')
 tracks(5.2,1.5,16,.7)
 box('Sloped glacis',(2.8,4.7,.85),(0,0,1.32),'armor',.25)
 box('Snow camouflage',(2,1.5,.08),(0,-1.25,1.78),'snow')
 for side in [-1,1]:
  for y in [-1.8,-.9,0,.9,1.8]:box('Side skirt',(.2,.8,.7),(side*1.58,y,1.3),'snow' if y<0 else 'armor',.03)
  box('Culture marking',(.05,2,.2),(side*1.42,.4,1.55),'trim',.01)
 box('Turret',(2.5,2.5,.85),(0,-.1,2.17),'armor',.3)
 box('Turret winter plate',(2.1,.8,.12),(0,-.75,2.63),'snow',.06)
 for x in [-.42,.42]:
  cyl('Gun mantlet',.24,.7,(x,-1.5,2.2),'armor',(math.pi/2,0,0))
  cyl('Twin cannon',.1,2.9,(x,-3.2,2.2),'steel',(math.pi/2,0,0))
  cyl('Muzzle',.15,.25,(x,-4.6,2.2),'dark',(math.pi/2,0,0))
 cyl('Commander cupola',.4,.25,(-.5,.4,2.7),'steel');box('Optics',(.4,.4,.3),(.6,-.5,2.75),'glass')
 box('Reactive armor',(1.2,.9,.14),(0,.6,2.67),'dark',.02)
 for side in [-1,1]:
  for i in range(5):cyl('Smoke launcher',.06,.25,(side*1.1,-1+i*.18,2.4),'dark',(.9,0,0))
 for x in [-.9,.9]:box('Headlight',(.28,.06,.15),(x,-2.38,1.35),'light',.02)
 for i in range(7):box('Engine vent',(1.6,.05,.04),(0,1.3+i*.14,1.78),'dark',.005)

def gunship():
 new('gunship')
 for side in [-1,1]:
  box('Landing skid',(.08,3,.08),(side*.8,0,.3),'steel',.01)
  for y in [-.9,.9]:beam((side*.8,y,.3),(side*.55,y,1.35),.035)
  box('Stub wing',(1.5,.7,.14),(side*1.15,.2,1.9),'armor',.03)
  cyl('Rocket pod',.22,1.2,(side*1.72,.1,1.75),'dark',(math.pi/2,0,0),12)
  for i in range(4):cyl('Rocket',.045,.1,(side*1.72+(.1 if i%2 else -.1),-.53,1.75+(.1 if i<2 else -.1)),'orange',(math.pi/2,0,0),8)
 box('Fuselage',(1.3,4,1.2),(0,0,1.85),'armor',.3)
 box('Belly armor',(1.1,3,.15),(0,.1,1.28),'snow',.03)
 box('Cockpit glass',(1,1.3,.7),(0,-1.85,2.05),'glass',.25)
 box('Chin turret',(.5,.5,.4),(0,-1.5,1.3),'steel',.05);cyl('Chin gun',.04,.9,(0,-2.1,1.3),'dark',(math.pi/2,0,0),8)
 box('Tail boom',(.5,3.2,.5),(0,3.4,2.15),'armor',.15)
 box('Tail fin',(.12,.9,1.1),(0,4.85,2.85),'snow',.03)
 box('Horizontal stabilizer',(1.6,.5,.08),(0,4.5,2.35),'armor',.02)
 box('Engine cowl',(1.1,1.4,.5),(0,.4,2.55),'snow',.1);cyl('Turbine exhaust',.16,.5,(.45,1.2,2.6),'dark',(math.pi/2,0,0))
 box('Culture band',(1.35,.8,.05),(0,-.5,2.5),'trim',.01)
 cyl('Rotor mast',.12,.6,(0,0,2.9),'steel')
 pivot=bpy.data.objects.new('rotor_pivot',None);bpy.context.collection.objects.link(pivot);pivot.parent=root;pivot.location=(0,0,3.15)
 cyl('Rotor hub',.3,.2,(0,0,3.15),'dark')
 for a in [0,math.pi/2]:
  blade=box('Main rotor blade',(7.4,.3,.05),(0,0,3.18),'dark',.01,(0,0,a));blade.location-=pivot.location;blade.parent=pivot
 mount=bpy.data.objects.new('tail_rotor_mount',None);bpy.context.collection.objects.link(mount);mount.parent=root;mount.location=(.34,4.75,2.9);mount.rotation_euler=(0,math.pi/2,0)
 tail=bpy.data.objects.new('rotor_pivot_tail',None);bpy.context.collection.objects.link(tail);tail.parent=mount
 for a in [0,math.pi/2]:
  bpy.ops.mesh.primitive_cube_add(size=1,location=(0,0,0));o=own(bpy.context.object,'Tail rotor blade','dark');o.scale=(1.5,.16,.04);bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler=(0,0,a);o.parent=tail

def barracks():
 building('barracks',5,4.5)
 cyl('Flagpole',.05,4.6,(2.3,1.6,2.45),'steel');box('Banner',(.06,.95,.62),(2.3,2.05,4.35),'trim',.01)
 for i in range(6):box('Sandbag',(.55,.3,.26),(-2.6+i*.5,-2.95,.41),'wood',.03)
 for i in range(3):box('Sandbag',(.55,.3,.26),(-2.35+i*.5,-2.95,.66),'wood',.03)
 box('Training target',(.7,.08,1.1),(-2.6,-2.3,1.05),'wood',.01);box('Target ring',(.35,.02,.35),(-2.6,-2.35,1.15),'orange',.005)
 cyl('Radio whip',.03,2.4,(-2.1,1.9,5.3),'steel',vertices=8)
 box('Equipment locker',(.9,.5,1.4),(2.55,-1.2,.98),'armor',.03)
 for x in [-1.4,0,1.4]:box('Rifle rack',(.9,.3,.5),(x,2.55,1.15),'dark',.02)

def lab():
 building('lab',5,4.5)
 sphere('Observation dome',(0,.4,4.85),(1.35,1.35,1),'glass')
 cyl('Dome ring',1.4,.18,(0,.4,4.65),'steel',vertices=32)
 cyl('Dish mast',.08,2,(-1.7,1.5,5.4),'steel')
 o=sphere('Dish',(-1.7,1.5,6.45),(.85,.85,.3),'snow');o.rotation_euler=(.6,0,0)
 cyl('Dish feed',.03,.9,(-1.7,1.5,6.85),'steel',(.6,0,0),8)
 cyl('Cryogenic tank',.42,1.7,(2.8,1.1,1.13),'snow',vertices=20);cyl('Tank band',.44,.18,(2.8,1.1,1.6),'trim',vertices=20)
 for i in range(3):cyl('Coolant pipe',.06,1.2,(2.4,-.6+i*.5,.9),'steel',(0,math.pi/2,0),8)
 box('Sensor array',(.6,.6,.9),(1.8,-1.3,4.9),'trim',.05)
 for i in range(4):box('Server rack',(.06,.5,.5),(1.85,-1.8+i*.35,5.5),'light',.005)
 box('Field lab container',(1.2,2,1.1),(-2.65,-1.2,.82),'armor',.04);box('Container stripe',(1.22,.3,.1),(-2.65,-1.2,1.2),'orange',.01)

def airfield():
 new('airfield')
 box('Landing pad',(9,7,.3),(0,0,.15),'concrete',.05)
 cyl('Landing circle',2.9,.02,(.6,-.2,.31),'gold',vertices=48);cyl('Circle centre',2.55,.03,(.6,-.2,.31),'concrete',vertices=48)
 box('H marking',(1.2,.18,.02),(.6,-.2,.33),'snow',0)
 for x in [-.5,.5]:box('H marking',(.18,1.2,.02),(.6+x,-.2,.33),'snow',0)
 box('Control hut',(2,1.6,2.2),(-3.2,2.3,1.4),'red',.05);box('Hut roof',(2.3,1.9,.12),(-3.2,2.3,2.55),'steel',.02)
 box('Hut glazing',(1.6,.06,.6),(-3.2,1.48,1.8),'glass',.01)
 box('Beacon',(.25,.25,.5),(-3.2,2.3,2.85),'light',.02)
 cyl('Windsock pole',.04,3,(3.8,2.8,1.8),'steel',vertices=8)
 o=cyl('Windsock',.18,1.1,(4.2,2.8,3.2),'orange',(0,math.pi/2,0),10)
 for x in [-4.2,4.2]:
  for y in [-3.2,3.2]:box('Perimeter light',(.22,.22,.28),(x,y,.44),'light',.02)
 for i in range(3):cyl('Fuel drum',.38,.85,(3.4+(i%2)*.8,-2.5-(i//2)*.8,.72),'orange',vertices=14)
 box('Ground power unit',(1,.7,.7),(2.2,-2.9,.65),'armor',.03)
 box('Culture stripe',(.5,6,.03),(-4.15,-.3,.32),'trim',.005)
 for y in [-2.4,0,2.4]:box('Tie-down',(.3,.3,.06),(2,y,.33),'steel',.01)

def battery():
 new('battery');box('Casemate',(4.2,4.2,.6),(0,0,.3),'concrete',.3)
 for i in range(8):
  a=i*math.pi/4;box('Sandbag',(.6,.32,.28),(math.cos(a)*1.75,math.sin(a)*1.75,.74),'wood',.03,(0,0,a))
 cyl('Turret ring',1.3,.3,(0,0,.75),'steel',vertices=24)
 box('Turret',(2.6,2.4,1.1),(0,.2,1.5),'armor',.25);box('Winter plate',(2.2,.9,.12),(0,-.6,2.1),'snow',.03)
 for x in [-.45,.45]:
  cyl('Gun mantlet',.22,.5,(x,-1.15,1.65),'armor',(math.pi/2-.2,0,0))
  cyl('155mm coastal gun',.12,3.2,(x,-2.55,1.95),'dark',(math.pi/2-.2,0,0))
  cyl('Muzzle brake',.17,.3,(x,-4.05,2.25),'steel',(math.pi/2-.2,0,0))
 box('Rangefinder',(1,.3,.3),(0,.95,2.25),'trim',.05);box('Optics',(.35,.3,.22),(.9,-.4,2.2),'glass')
 cyl('Ammunition hoist',.3,.8,(-1.5,1.4,1),'steel');box('Shell crate',(.8,.5,.4),(1.5,1.4,.8),'wood',.02)

def outpost():
 new('outpost');box('Foundation',(4,4,.28),(0,0,.14),'concrete',.05)
 box('Field hut',(2.4,2,2.1),(-.6,.3,1.32),'red',.05);box('Hut roof',(2.7,2.3,.12),(-.6,.3,2.43),'steel',.02)
 box('Hut window',(.7,.06,.5),(-.6,-.73,1.6),'glass',.01);box('Door',(.8,.06,1.6),(.2,-.73,1.1),'dark',.02)
 cyl('Radio mast',.07,5.5,(1.3,-.9,2.9),'steel')
 for z in [4.2,5]:box('Antenna crossbar',(1.2,.05,.05),(1.3,-.9,z),'steel')
 sphere('Radome',(1.3,-.9,5.9),(.35,.35,.32),'snow')
 box('Generator',(1,.7,.7),(1.2,1.1,.63),'armor',.03);cyl('Generator exhaust',.05,.6,(1.5,1.1,1.2),'steel',vertices=8)
 box('Culture panel',(.06,1.2,.6),(-1.83,.3,1.5),'trim',.01)
 box('Floodlight',(.3,.15,.12),(1.3,-1.05,3.4),'light',.02)
 for i in range(4):box('Sandbag',(.55,.3,.26),(-1.6+i*.5,-1.75,.41),'wood',.03)

def building(kind,w,d):
 new(kind)
 box('Concrete foundation',(w+1,d+1,.28),(0,0,.14),'concrete',.05)
 box('Weatherboard walls',(w,d,2.8),(0,0,1.67),'red',.035)
 # Vertical timber cladding, exposed steel portal frames, standing-seam roof.
 for side in [-1,1]:
  for i in range(int(d/.3)):
   box('Timber rib',(.08,.07,2.55),(side*(w/2+.02),-d/2+.15+i*.3,1.6),'wood',.01)
  for y in [-d/2,d/2]:box('Portal frame',(.15,.16,3.1),(side*w/2,y,1.7),'steel',.01)
 rise=1.3; angle=math.atan2(rise,w/2)
 for side in [-1,1]:
  box('Pitched zinc roof',(math.hypot(w/2,rise)+.3,d+.6,.14),(side*w/4,0,3.15+rise/2),'steel',.01,(0,side*angle,0))
  for i in range(int(d/.55)+1):beam((0,-d/2+i*.55,4.52),(side*(w/2+.22),-d/2+i*.55,3.07),.028,'snow')
 box('Ridge cap',(.18,d+.8,.1),(0,0,4.55),'snow',.02)
 box('Door',(1.5,.1,2.2),(0,-d/2-.04,1.42),'dark',.025)
 for y in [-d/2-.12]:
  box('Door frame',(1.8,.15,.16),(0,y,2.56),'trim')
  for x in [-w*.32,w*.32]:
   box('Window',(.85,.12,.7),(x,y,2.1),'glass')
   box('Window bar',(.05,.14,.74),(x,y-.04,2.1),'steel')
   box('Floodlight',(.4,.2,.1),(x,y,2.78),'light')
 for x in [-w*.4,w*.4]:box('Foundation bollard',(.18,.18,.8),(x,-d/2-1,.6),'gold')

def station():
 building('hq',5.5,5)
 cyl('Radio mast',.09,4,(1.5,1.2,5.2),'steel');beam((1.5,1.2,6),(0,0,3.6),.025)
 sphere('Radome',(1.5,1.2,7.2),(.7,.7,.65),'snow')
 for z in [5,5.8,6.6]:box('Antenna crossbar',(1.6,.06,.06),(1.5,1.2,z),'steel')
 box('Service annex',(2.2,2.5,2),(-3.4,.5,1.25),'steel');box('Signal strip',(.1,1.7,.3),(-4.53,.5,1.7),'trim')

def factory():
 building('factory',6,7)
 box('Shutter',(3.8,.17,2.6),(0,-3.56,1.61),'steel')
 for i in range(12):box('Shutter slat',(3.75,.05,.045),(0,-3.68,.45+i*.21),'snow',.005)
 box('Vehicle apron',(6,5,.09),(0,-6,.31),'concrete')
 for x in [-2,2]:box('Apron marking',(.09,4,.02),(x,-6,.365),'gold',.005)
 for side in [-1,1]:
  cyl('Exhaust',.15,1.4,(side*2.3,2.2,4),'steel');cyl('Stack cap',.24,.07,(side*2.3,2.2,4.7),'dark')

def reactor():
 new('reactor');box('Foundation',(5,5,.3),(0,0,.15),'concrete')
 for x in [-1,1]:
  cyl('Heat exchanger',.8,2.4,(x,.3,1.55),'steel',vertices=24);cyl('Insulation band',.84,.2,(x,.3,2.55),'trim')
  for z in [.8,1.6,2.3]:cyl('Tank rib',.82,.09,(x,.3,z),'snow',vertices=24)
  cyl('Vent',.43,.5,(x,.3,3),'dark');beam((x,-.5,2.2),(x,-1.7,2.2),.15)
 box('Control cabinet',(1.7,1,1.3),(0,-1.6,.96),'red');box('Status panel',(.7,.06,.36),(0,-2.13,1.3),'light')
 for x in [-2,2]:beam((x,1,.3),(x,1,2),.04,'gold')

def refinery():
 building('refinery',4.5,4)
 for x in [-2.9,2.9]:
  cyl('Fuel tank',.65,2,(x,.3,1.3),'snow');cyl('Band',.67,.2,(x,.3,1.7),'trim')
 for i in range(5):box('Supply container',(1,.8,.6),(-1.4+(i%3)*1.2,3+math.floor(i/3),.6),'armor')

def turret():
 new('turret');box('Gun emplacement',(3.4,3.4,.4),(0,0,.2),'concrete',.3)
 cyl('Turret pedestal',.85,1.1,(0,0,.9),'steel',vertices=24)
 box('Autocannon housing',(1.9,1.7,.85),(0,0,1.76),'snow',.23)
 for x in [-.48,.48]:cyl('40mm cannon',.09,2.6,(x,-1.75,1.86),'dark',(math.pi/2,0,0))
 box('Radar',(.65,.3,.6),(0,.25,2.52),'trim',.08);box('Optical sight',(.35,.3,.22),(.65,-.6,2.2),'glass')

tank();lynx();ranger();rocket();drone();harvester();howitzer();jotun();gunship();station();factory();reactor();refinery();turret();barracks();lab();airfield();battery();outpost()
# Join geometry by material to keep actual browser draw calls bounded.
for r in allroots:
 children=list(r.children_recursive)
 for o in children:
  if o.type=='MESH':
   bpy.context.view_layer.objects.active=o
   for mod in list(o.modifiers):bpy.ops.object.modifier_apply(modifier=mod.name)
 for mat in M.values():
  group=[o for o in list(r.children) if o.type=='MESH' and mat in list(o.data.materials)]
  if len(group)>1:
   bpy.ops.object.select_all(action='DESELECT')
   for o in group:o.select_set(True)
   bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
   group[0].name=r.name+'_'+mat.name
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/tactical.blend'))
for r in allroots:
 bpy.ops.object.select_all(action='DESELECT');r.select_set(True)
 for o in r.children_recursive:o.select_set(True)
 bpy.context.view_layer.objects.active=r
 bpy.ops.export_scene.gltf(filepath=str(OUT/(r.name+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
# Render portraits from the same authored models; no invented UI image URLs.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=256;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.world.color=(.35,.35,.35)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
for p,energy,size in [((5,-7,10),1600,7),((-6,-1,6),1000,6)]:
 bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.data.energy=energy;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
for r in allroots:
 for other in allroots:
  for o in other.children_recursive:o.hide_render=other!=r
 size={'hq':9,'factory':9,'refinery':9,'barracks':9,'lab':9,'airfield':10.5,'reactor':6,'tank':6,'turret':6,'battery':6.5,'outpost':6.5,'jotun':6.8,'howitzer':6,'harvester':6,'gunship':7.5,'drone':5,'lynx':5,'ranger':2.8,'rocket':2.8}[r.name]
 target=Vector((0,0,{'hq':2.6,'factory':1.8,'refinery':1.8,'barracks':1.8,'lab':2.2,'airfield':.6,'outpost':2,'gunship':1.9}.get(r.name,1)))
 camera.location=target+Vector((size,-size*1.35,size*.95));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.35
 scene.render.filepath=str(ICONS/(r.name+'.png'));bpy.ops.render.render(write_still=True)
print('Tactical library complete: %d original assets and portraits.'%len(allroots))
