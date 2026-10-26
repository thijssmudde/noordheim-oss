"""Noordheim's second architecture pass: complete buildings designed for orbiting.
Run through Blender MCP or pnpm art:tactical architecture. One vertex-colour body
and one faction material per building; no texture downloads or transparent cards.
"""
import bpy
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/tactical'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for material in list(bpy.data.materials):
 bpy.data.materials.remove(material,do_unlink=True)
roots=[]
colors={'red':'963f32','darkred':'70372f','wood':'95785c','stone':'92978b','cream':'d7d5bc','roof':'424f53','dark':'263738','glass':'799a9b','iron':'5d6965','gold':'baa05e','ore':'9a7043'}
def linear(c):
 return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
def color(h):
 return tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))
mat=bpy.data.materials.new('Nordic timber and stone');mat.use_nodes=True
p=mat.node_tree.nodes.get('Principled BSDF');p.inputs['Roughness'].default_value=.82
v=mat.node_tree.nodes.new('ShaderNodeVertexColor');v.layer_name='Col'
mat.node_tree.links.new(v.outputs['Color'],p.inputs['Base Color'])
trim=bpy.data.materials.new('culture_trim');trim.use_nodes=True
trim.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(*color('547c86'),1)
trim.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.8

def finish(o,name,shade):
 o.name=name;o.parent=roots[-1]
 o.data.materials.append(trim if shade=='trim' else mat)
 if shade!='trim':
  attr=o.data.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
  base=color(colors[shade])
  for poly in o.data.polygons:
   # Calm material variation and occlusion painted into underside faces.
   light=.80+.20*max(0,poly.normal.z)
   for i in poly.loop_indices:attr.data[i].color=tuple(c*light for c in base)+(1,)
 return o

def box(name,loc,size,shade,bevel=.035,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 if bevel:
  m=o.modifiers.new('Crafted edges','BEVEL');m.width=bevel;m.segments=1;bpy.ops.object.modifier_apply(modifier=m.name)
 o.rotation_euler=rotation
 return finish(o,name,shade)

def mesh(name,verts,faces,shade):
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o)
 return finish(o,name,shade)

def beam(name,a,b,width,shade):
 from mathutils import Vector
 a,b=Vector(a),Vector(b)
 o=box(name,(a+b)/2,(width,width,(b-a).length),shade,.012)
 o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler();return o

def cylinder(name,loc,r,height,shade):
 bpy.ops.mesh.primitive_cylinder_add(vertices=12,radius=r,depth=height,location=loc)
 return finish(bpy.context.object,name,shade)

def new(name):
 root=bpy.data.objects.new(name,None);bpy.context.collection.objects.link(root);root['tactical_kind']=name;roots.append(root)

def window(x,y,z,side=False):
 box('Cream window frame',(x,y,z),(.13,.94,.91) if side else (.94,.13,.91),'cream')
 box('Recessed blue glass',(x+((.073 if x>0 else -.073) if side else 0),y+(0 if side else .073),z),(.04,.76,.72) if side else (.76,.04,.72),'glass',.015)
 box('Window mullion',(x+((.10 if x>0 else -.10) if side else 0),y+(0 if side else .10),z),(.035,.055,.76) if side else (.055,.035,.76),'cream',.008)

def shell(name,w,d,h=2.8,rise=1.35):
 new(name)
 box('Stone plinth',(0,0,.18),(w+.65,d+.65,.36),'stone',.10)
 box('Timber building',(0,0,h/2+.35),(w,d,h),'red',.07)
 for side in [-1,1]:
  y=side*(d/2+.01)
  # Solid gables, visible from either end.
  mesh('Closed timber gable',[(x,y+off,z) for off in [-.06,.06] for x,z in [(-w/2,h+.35),(w/2,h+.35),(0,h+.35+rise)]],[(2,1,0),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)],'red')
  for x in [-w/2+.05,w/2-.05]:
   box('Corner timber',(x,y,h/2+.4),(.18,.19,h+.15),'cream')
  box('Gable crossbeam',(0,y,h+.34),(w+.2,.17,.16),'cream')
  beam('Gable bargeboard',(-w/2-.13,y,h+.30),(0,y,h+.44+rise),.14,'cream')
  beam('Gable bargeboard',(w/2+.13,y,h+.30),(0,y,h+.44+rise),.14,'cream')
 for side in [-1,1]:
  angle=math.atan2(rise,w/2)
  box('Standing seam roof',(side*w/4,0,h+.35+rise/2),(math.hypot(w/2,rise)+.32,d+.55,.16),'roof',.025,(0,side*angle,0))
  for j in range(int(d/.9)+1):
   y=-d/2+j*.9
   beam('Quiet roof seam',(0,y,h+.48+rise),(side*(w/2+.13),y,h+.42),.035,'iron')
  box('Wall sill',(side*(w/2+.035),0,.55),(.16,d,.20),'wood')
  for y in [-d*.28,d*.28]:
   # Side openings are geometry on both façades; mirror local right-facing frames.
   o=window(side*(w/2+.04),y,2.05,True)
  for y in [-d*.25,d*.25]:
   box('Wall post',(side*(w/2+.10),y,h/2+.4),(.14,.15,h),'wood')
 box('Roof ridge',(0,0,h+.48+rise),(.18,d+.7,.16),'iron')
 # Rear service entrance reads clearly from the original north-up camera.
 box('Rear dispatch door',(0,d/2+.07,1.42),(1.4,.13,2.1),'dark')
 for x in [-.79,.79]:box('Door jamb',(x,d/2+.14,1.45),(.15,.18,2.25),'cream')
 box('Door lintel',(0,d/2+.14,2.61),(1.74,.18,.17),'cream')
 box('Entry step',(0,d/2+.25,.25),(2,.8,.25),'stone')
 for x in [-w*.32,w*.32]:window(x,d/2+.08,2.04)
 box('Faction board',(0,d/2+.17,3.45),(1.0,.12,.48),'trim')

shell('barracks',5,4.5)
box('Entrance canopy',(0,2.64,2.83),(2.3,.88,.15),'roof')
for x in [-1,1]:box('Porch post',(x,2.99,1.50),(.14,.14,2.75),'wood')
for x in [-1.6,1.6]:
 box('Bench',(x,2.73,.62),(.9,.45,.13),'wood')
 for y in [2.58,2.88]:box('Bench legs',(x,y,.43),(.65,.09,.35),'iron')
cylinder('Chimney',(-1.35,-.8,4.45),.23,1.4,'stone')
box('Chimney cap',(-1.35,-.8,5.2),(.62,.62,.18),'dark')

shell('factory',6,7,3.25,1.15)
# Taller portal and paired workshop doors on both ends.
for side in [-1,1]:
 y=side*3.68
 box('Workshop shutter',(0,y,1.74),(3.75,.14,2.75),'dark')
 for x in [-2.02,2.02]:box('Steel portal',(x,y,1.86),(.24,.30,3.1),'wood')
 box('Portal lintel',(0,y,3.36),(4.3,.32,.25),'wood')
 for z in [.65,1.1,1.55,2,2.45,2.9]:box('Shutter fold',(0,y+side*.09,z),(3.7,.06,.055),'iron',.005)
 box('Workshop awning',(0,y+side*(.12 if side>0 else .5),3.57),(4.6,.7 if side>0 else 1.3,.16),'roof')
 for x in [-2.4,2.4]:cylinder('Safety bollard',(x,y+side*(.30 if side>0 else .7),.68),.13,.82,'gold')
box('Vehicle apron',(0,-6,.29),(6,4.7,.12),'stone')
for x in [-2,2]:box('Apron lane',(x,-6,.36),(.10,4,.025),'gold',0)
for x in [-2.25,2.25]:
 cylinder('Vent stack',(x,-1.8,4.4),.18,1.5,'iron')
 box('Stack hood',(x,-1.8,5.19),(.65,.5,.12),'dark')
box('Roof clerestory',(0,.35,4.7),(2.6,3.4,.65),'darkred')
box('Clerestory roof',(0,.35,5.07),(2.9,3.7,.16),'roof')
for side in [-1,1]:
 for y in [-.6,.4,1.4]:box('Clerestory glazing',(side*1.32,y,4.76),(.05,.66,.28),'glass',.012)

shell('refinery',4.5,4,2.85,1.15)
for x in [-2.9,2.9]:
 cylinder('Ore processing silo',(x,0,1.55),.64,2.6,'stone')
 for z in [.5,1.5,2.6]:cylinder('Silo band',(x,0,z),.68,.10,'iron')
 cylinder('Silo cap',(x,0,2.94),.55,.20,'roof')
 beam('Feed pipe',(x,0,2.8),(x/2,0,3.8),.20,'iron')
box('Crusher housing',(0,-2.7,1.35),(2.7,1.1,1.8),'iron')
box('Intake mouth',(0,-3.29,1.5),(2.2,.08,.85),'dark')
for x in [-.9,-.45,0,.45,.9]:box('Intake grate',(x,-3.35,1.5),(.08,.08,.85),'gold',.01)
box('Ore chute',(0,2.96,1.08),(1.5,1.5,.22),'iron')
for x in [-.84,.84]:box('Chute side',(x,2.96,1.29),(.17,1.5,.6),'iron')
for i in range(3):box('Ore crate',(-1.15+i*1.15,3.8,.45),(1,.72,.68),'wood')

for root in roots:
 for material in [mat,trim]:
  parts=[o for o in root.children_recursive if o.type=='MESH' and o.data.materials[0]==material]
  bpy.ops.object.select_all(action='DESELECT')
  for o in parts:o.select_set(True)
  bpy.context.view_layer.objects.active=parts[0]
  bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
  bpy.ops.object.join();o=bpy.context.object;o.name=root.name+('_body' if material==mat else '_marking')
  o.data.materials.clear();o.data.materials.append(material)
  for face in o.data.polygons:face.material_index=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/architecture.blend'))
for root in roots:
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(OUT/(root.name+'.glb')),export_format='GLB',use_selection=True,export_extras=True,export_yup=True)
print('Three orbit-ready buildings exported.')

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=16
scene.render.resolution_x=256;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.world.color=(.35,.35,.35)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO';camera.data.ortho_scale=12
from mathutils import Vector
for loc,energy,size in [((5,-7,10),1600,7),((-6,-1,6),1000,6)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=energy;light.data.shape='DISK';light.data.size=size
 light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
for root in roots:
 for other in roots:
  for obj in other.children_recursive:obj.hide_render=other!=root
 target=Vector((0,0,2));camera.location=target+Vector((9,-12,9));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(ROOT/'public/art/tactical'/(root.name+'.png'));bpy.ops.render.render(write_still=True)
for root in roots:
 for obj in root.children_recursive:obj.hide_render=False
