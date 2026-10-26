"""Northern Command's expansion structures: six shared buildings that grow the
tech tree with concrete rather than research. Same neutral palette, cloned
culture_trim paint, GLB export and portraits as create_tactical.py.
Run through Blender MCP or pnpm art:tactical expansion.
"""
import bpy, math
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/tactical'; OUT.mkdir(parents=True,exist_ok=True)
ICONS=ROOT/'public/art/tactical'; ICONS.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
for material in list(bpy.data.materials):bpy.data.materials.remove(material,do_unlink=True)
M={}
colors={'armor':'697976','snow':'c2c9bf','dark':'202c30','rubber':'161e21','steel':'46575e','trim':'4299b6','glass':'163e50','light':'c0f3f4','red':'78433b','wood':'78644e','concrete':'8d9892','gold':'c8ab64','orange':'d57e43','canvas':'b8ad8f'}
for key,h in colors.items():
 linear=lambda c:c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
 m=bpy.data.materials.new('culture_trim' if key=='trim' else key);m.diffuse_color=tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))+(1,);m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=m.diffuse_color;p.inputs['Roughness'].default_value=.7 if key in ['wood','concrete','rubber','canvas'] else .4
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

def cone(name,r1,r2,d,p,mat='steel',vertices=24):
 bpy.ops.mesh.primitive_cone_add(vertices=vertices,radius1=r1,radius2=r2,depth=d,location=p);o=own(bpy.context.object,name,mat)
 o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o

def beam(a,b,r=.03,mat='steel'):
 a,b=Vector(a),Vector(b);o=cyl('Brace',r,(b-a).length,(a+b)/2,mat);o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def sphere(name,p,scale,mat):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=p);o=own(bpy.context.object,name,mat);o.scale=scale;return o

def new(name):
 global root
 root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root);root['tactical_kind']=name;allroots.append(root)

def sandbags(cx,cy,n,z=.41,angle=0):
 for i in range(n):
  x=cx+(i-(n-1)/2)*.5
  box('Sandbag',(.55,.3,.26),(cx+math.cos(angle)*(x-cx),cy+math.sin(angle)*(x-cx),z),'wood',.03,(0,0,angle))

def bunker():
 """Pillbox: a low concrete casemate with a machine-gun slit. Cheap anti-infantry cover."""
 new('bunker');box('Casemate base',(4.4,4.4,.5),(0,0,.25),'concrete',.2)
 box('Casemate',(3.4,3.2,1.5),(0,.2,1.2),'concrete',.28)
 box('Roof slab',(3.7,3.5,.3),(0,.2,2.05),'concrete',.08)
 box('Firing slit',(2.2,.12,.32),(0,-1.42,1.55),'dark',.01)
 cyl('Machine gun',.07,1.5,(-.35,-2.0,1.55),'dark',(math.pi/2,0,0),10);box('Gun shield',(.7,.08,.5),(-.35,-1.55,1.55),'steel',.02)
 box('Blast door',(.9,.1,1.3),(1.0,1.83,.95),'dark',.02);box('Door frame',(1.1,.14,.14),(1.0,1.85,1.66),'trim',.01)
 for side in [-1,1]:sandbags(side*1.9,-1.4,4,.66,math.pi/2)
 sandbags(0,-2.1,5,.66)
 cyl('Periscope',.07,.9,(.9,.6,2.55),'steel',vertices=8);box('Periscope head',(.22,.14,.14),(.9,.6,3.0),'glass',.01)
 box('Culture marking',(.9,.06,.3),(0,-1.61,2.05),'trim',.01)
 cyl('Vent',.18,.35,(-.9,.9,2.3),'dark',vertices=10)

def flak():
 """Flak tower: an octagonal concrete tower with twin autocannons and a search radar. Anti-air."""
 new('flak');box('Foundation',(5,5,.3),(0,0,.15),'concrete',.05)
 cyl('Tower',1.6,3.2,(0,0,1.9),'concrete',vertices=8);cyl('Tower cap',1.85,.3,(0,0,3.6),'concrete',vertices=8)
 for i in range(8):
  a=i*math.pi/4;box('Buttress',(.35,.5,3.0),(math.cos(a)*1.55,math.sin(a)*1.55,1.75),'concrete',.03,(0,0,a))
 cyl('Turret ring',1.0,.25,(0,0,3.85),'steel',vertices=24)
 box('Gun cradle',(1.9,1.4,.8),(0,0,4.35),'armor',.12);box('Winter plate',(1.6,.7,.1),(0,-.55,4.8),'snow',.03)
 for x in [-.32,.32]:
  cyl('Autocannon',.08,2.4,(x,-1.5,4.55),'dark',(math.pi/2+.35,0,0),10)
  cyl('Flash hider',.12,.25,(x,-2.55,4.95),'steel',(math.pi/2+.35,0,0),10)
 cyl('Radar mast',.07,1.4,(.9,.7,5.3),'steel',vertices=8)
 o=sphere('Search radar',(.9,.7,6.05),(.7,.7,.28),'snow');o.rotation_euler=(.9,0,.6)
 box('Fire control',(.6,.5,.4),(-.8,.7,4.95),'trim',.04);box('Range optics',(.3,.28,.2),(-.8,.35,5.2),'glass',.01)
 for i in range(3):cyl('Ammunition drum',.32,.6,(1.9+(i%2)*.7,-1.9+(i//2)*.7,.6),'orange',vertices=12)
 box('Stair',(.7,1.6,.15),(-1.9,.3,.6),'steel',.01)
 for z in [.9,1.4,1.9,2.4,2.9]:box('Ladder rung',(.55,.06,.05),(-1.9,-.9,z),'steel',.005)
 box('Culture band',(.12,3.4,.35),(-1.7,0,3.05),'trim',.01)

def radar():
 """Radar mast: a lattice tower with a rotating dish above a crew hut. Long sight."""
 new('radar');box('Foundation',(4.4,4.4,.28),(0,0,.14),'concrete',.05)
 box('Crew hut',(2.2,1.8,2.0),(-.9,.9,1.28),'red',.05);box('Hut roof',(2.5,2.1,.12),(-.9,.9,2.34),'steel',.02)
 box('Hut glazing',(1.4,.06,.55),(-.9,-.03,1.65),'glass',.01);box('Hut door',(.7,.06,1.4),(.0,.9,1.0),'dark',.02)
 for x,y in [(-.85,-.85),(.85,-.85),(.85,.85),(-.85,.85)]:beam((x*1.3,y*1.3,.3),(x*.6,y*.6,6.0),.06)
 for z in [1.6,3.0,4.4]:
  s=1.3-(z/6)*.7
  for a,b in [((-1,-1),(1,-1)),((1,-1),(1,1)),((1,1),(-1,1)),((-1,1),(-1,-1))]:beam((a[0]*s,a[1]*s,z),(b[0]*s,b[1]*s,z),.03)
 cyl('Mast head',.45,.3,(0,0,6.15),'steel',vertices=16)
 cyl('Bearing',.18,.5,(0,0,6.5),'armor',vertices=12)
 o=sphere('Dish',(0,-.35,7.1),(1.35,1.35,.42),'snow');o.rotation_euler=(1.1,0,0)
 beam((0,-.35,7.1),(0,-1.3,7.95),.035);sphere('Feed horn',(0,-1.3,7.95),(.14,.14,.14),'dark')
 box('Dish counterweight',(.5,.5,.4),(0,.75,6.9),'armor',.04)
 box('Signal cabinet',(1.0,.6,1.1),(1.3,1.3,.83),'armor',.03);box('Status lamps',(.5,.06,.2),(1.3,.98,1.1),'light',.01)
 box('Culture panel',(.06,1.1,.55),(-2.03,.9,1.5),'trim',.01)
 box('Beacon',(.2,.2,.3),(0,0,6.45),'light',.02)
 sandbags(1.4,-1.5,4,.41)

def plant():
 """Thermal power station: twin cooling towers and a turbine hall. Tier 2 grid power."""
 new('plant');box('Foundation',(7,7,.3),(0,0,.15),'concrete',.05)
 for x in [-1.9,1.9]:
  cone('Cooling tower',1.45,1.05,4.6,(x,1.3,2.6),'concrete',28)
  cyl('Tower crown',1.1,.22,(x,1.3,4.95),'snow',vertices=28)
  cyl('Tower band',1.5,.14,(x,1.3,.95),'trim',vertices=28)
  cyl('Steam',.55,.6,(x,1.3,5.35),'snow',vertices=14)
 box('Turbine hall',(6.0,2.6,2.4),(0,-1.9,1.5),'red',.05)
 box('Hall roof',(6.4,3.0,.16),(0,-1.9,2.78),'steel',.02)
 for x in [-2.2,-.75,.75,2.2]:box('Hall glazing',(1.0,.06,.7),(x,-3.24,1.7),'glass',.01)
 box('Switchgear',(1.4,1.0,1.4),(-2.6,.1,1.0),'armor',.04)
 for i in range(3):cyl('Insulator',.08,.7,(-3.0+i*.4,.1,2.05),'snow',vertices=8)
 for x in [-1.9,1.9]:beam((x,.2,2.6),(x*.5,-.55,2.4),.16)
 cyl('Main steam line',.22,5.2,(0,-.55,2.4),'steel',(0,math.pi/2,0),12)
 cyl('Exhaust stack',.28,3.4,(3.0,-.4,3.0),'steel',vertices=12);cyl('Stack cap',.36,.12,(3.0,-.4,4.75),'dark',vertices=12)
 box('Transformer',(1.2,.9,1.1),(2.9,1.9,.85),'armor',.04)
 for i in range(4):box('Cooling fin',(.06,.9,.9),(2.5+i*.26,1.9,.85),'steel',.005)
 box('Status panel',(1.2,.06,.4),(0,-3.24,2.45),'light',.01)
 box('Culture stripe',(6.0,.1,.2),(0,-3.27,.5),'trim',.01)

def workshop():
 """Field workshop: an open-sided repair shed with a gantry hoist. Repairs idle vehicles nearby."""
 new('workshop');box('Foundation',(7,7,.28),(0,0,.14),'concrete',.05)
 box('Service pit apron',(4.6,4.2,.06),(0,-.2,.31),'dark',0)
 for x in [-2.6,2.6]:
  for y in [-2.6,2.6]:box('Portal column',(.22,.22,3.6),(x,y,2.1),'steel',.01)
 for x in [-2.6,2.6]:box('Eave beam',(.2,5.6,.26),(x,0,3.95),'steel',.01)
 rise=.9
 for side in [-1,1]:
  box('Shed roof',(math.hypot(2.7,rise)+.2,6.0,.12),(side*1.35,0,4.1+rise/2),'steel',.01,(0,side*math.atan2(rise,2.7),0))
 box('Ridge',(.16,6.2,.1),(0,0,4.15+rise),'snow',.02)
 box('Back wall',(5.4,.14,3.5),(0,2.65,2.0),'red',.03)
 for x in [-1.6,1.6]:box('Back window',(1.1,.06,.6),(x,2.58,3.0),'glass',.01)
 box('Tool wall',(4.5,.2,1.2),(0,2.45,1.4),'wood',.02)
 box('Gantry rail',(5.4,.16,.16),(0,-1.0,3.8),'gold',.01);box('Gantry rail',(5.4,.16,.16),(0,1.0,3.8),'gold',.01)
 box('Hoist trolley',(.7,2.2,.24),(-.6,0,3.62),'orange',.02)
 cyl('Hoist chain',.03,1.3,(-.6,0,2.9),'steel',vertices=6);box('Hook block',(.3,.2,.3),(-.6,0,2.2),'dark',.02)
 box('Engine block',(1.1,.8,.7),(-.6,0,1.55),'armor',.04)
 box('Workbench',(2.2,.7,.9),(1.6,2.0,.75),'wood',.02);box('Welding rig',(.5,.5,.8),(2.9,1.3,.7),'orange',.02)
 for i in range(3):cyl('Spare tyre',.42,.28,(2.9-i*.05,-2.2+i*.3,.55),'rubber',(math.pi/2,0,0),14)
 box('Oil drums',(.5,.5,.8),(-2.9,-1.6,.7),'orange',.02);box('Parts crate',(.8,.6,.5),(-2.9,-.6,.55),'wood',.02)
 box('Culture banner',(.06,1.4,.7),(2.72,0,3.1),'trim',.01)
 box('Bay lamp',(.3,.3,.1),(0,-1.2,4.05),'light',.01)

def hospital():
 """Aid station: a canvas-roofed long hut with a heated ward. Heals idle infantry nearby."""
 new('hospital');box('Foundation',(6,5.4,.28),(0,0,.14),'concrete',.05)
 box('Ward walls',(4.6,3.6,1.5),(0,0,1.0),'red',.035)
 for side in [-1,1]:
  for i in range(11):box('Timber rib',(.07,.07,1.4),(side*2.32,-1.5+i*.3,1.0),'wood',.01)
 rise=1.2
 for side in [-1,1]:
  box('Canvas roof',(math.hypot(2.4,rise)+.3,4.2,.12),(side*1.2,0,1.75+rise/2),'canvas',.02,(0,side*math.atan2(rise,2.4),0))
 box('Ridge pole',(.14,4.6,.14),(0,0,1.78+rise),'wood',.02)
 for y in [-2.1,2.1]:box('Ridge post',(.16,.16,2.9),(0,y,1.6),'wood',.01)
 for y in [-2.15,2.15]:
  for x in [-1.9,1.9]:beam((x,y,.3),(x*1.3,y*1.15,.32),.02,'gold')
 box('Ward door',(1.2,.1,1.3),(0,-1.84,.95),'dark',.02);box('Door canopy',(1.6,.7,.1),(0,-2.2,1.75),'canvas',.02)
 for x in [-1.4,1.4]:box('Ward window',(.9,.08,.5),(x,-1.84,1.2),'glass',.01)
 box('Stove flue',(.16,.16,1.6),(1.6,1.0,2.6),'steel',.01);box('Flue cap',(.3,.3,.08),(1.6,1.0,3.42),'dark',.01)
 box('Supply tent',(1.8,1.6,.05),(-2.2,-1.4,1.25),'canvas',.01)
 for x,y in [(-2.9,-2.0),(-1.5,-2.0),(-2.9,-.8),(-1.5,-.8)]:beam((x,y,.3),(x,y,1.25),.03,'wood')
 for i in range(3):box('Medical crate',(.7,.5,.45),(-2.2,-2.0+i*.5,.55),'snow',.02)
 box('Stretcher',(1.6,.5,.08),(2.6,-.6,.66),'canvas',.01)
 for y in [-.85,-.35]:cyl('Stretcher handle',.03,2.0,(2.6,y,.66),'wood',(0,math.pi/2,0),8)
 box('Water tank',(.8,.8,1.0),(2.5,1.4,.78),'steel',.03);cyl('Tap',.03,.4,(2.1,1.4,.6),'gold',(0,math.pi/2,0),8)
 box('Field lantern',(.2,.2,.3),(0,-2.05,2.15),'light',.02)
 box('Culture panel',(.6,.06,.9),(-2.35,-1.84,1.1),'trim',.01)

bunker();flak();radar();plant();workshop();hospital()
# Join geometry by material to keep browser draw calls bounded.
for r in allroots:
 for o in list(r.children_recursive):
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
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/expansion.blend'))
for r in allroots:
 bpy.ops.object.select_all(action='DESELECT');r.select_set(True)
 for o in r.children_recursive:o.select_set(True)
 bpy.context.view_layer.objects.active=r
 bpy.ops.export_scene.gltf(filepath=str(OUT/(r.name+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
# Portraits from the same authored models, framed like the rest of the library.
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
 size={'bunker':6,'flak':7.5,'radar':8.5,'plant':9.5,'workshop':9,'hospital':8}[r.name]
 target=Vector((0,0,{'bunker':1.1,'flak':2.6,'radar':3.4,'plant':2.4,'workshop':2.0,'hospital':1.4}[r.name]))
 camera.location=target+Vector((size,-size*1.35,size*.95));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.35
 scene.render.filepath=str(ICONS/(r.name+'.png'));bpy.ops.render.render(write_still=True)
print('Expansion structures complete: %d assets and portraits.'%len(allroots))
