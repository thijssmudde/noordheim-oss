"""Portable authored crossing kit. Run: blender -b --python create_crossings.py
Dimensions are expressed in glTF X/right, Y/up, Z/span. No external assets.
"""
import bpy, math, random, json, os
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
random.seed(27)
def tint(c,a,b):
 k=random.uniform(a,b); return tuple(v*k for v in c)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
class Mesh:
 def __init__(self,name): self.name=name; self.v=[]; self.f=[]; self.colors=[]
 def geo(self,verts,faces,c,variation=.06):
  start=len(self.v); self.v += [(x,-z,y) for x,y,z in verts]
  for face in faces:
   self.f.append(tuple(start+i for i in face)); k=random.uniform(1-variation,1+variation); self.colors.append(tuple(min(1,max(0,x*k)) for x in c)+(1,))
 def box(self,center,size,c):
  x,y,z=center; a,b,d=[v/2 for v in size]
  self.geo([(x-a,y-b,z-d),(x+a,y-b,z-d),(x+a,y+b,z-d),(x-a,y+b,z-d),(x-a,y-b,z+d),(x+a,y-b,z+d),(x+a,y+b,z+d),(x-a,y+b,z+d)],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(3,7,6,2),(0,4,7,3),(1,2,6,5)],c)
 def beam(self,p,q,width,c,depth=None):
  p,q=Vector(p),Vector(q); axis=(q-p).normalized(); ref=Vector((0,1,0)) if abs(axis.y)<.95 else Vector((1,0,0)); a=axis.cross(ref).normalized()*width/2; b=axis.cross(a).normalized()*(depth or width)/2
  self.geo([tuple(t+sa*a+sb*b) for t in (p,q) for sa,sb in [(-1,-1),(1,-1),(1,1),(-1,1)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],c)
 def tube(self,p,q,r,c,n=6,r2=None):
  p,q=Vector(p),Vector(q); axis=(q-p).normalized(); ref=Vector((0,1,0)) if abs(axis.y)<.95 else Vector((1,0,0)); a=axis.cross(ref).normalized(); b=axis.cross(a).normalized()
  v=[tuple(t+(a*math.cos(i*2*math.pi/n)+b*math.sin(i*2*math.pi/n))*rad) for t,rad in [(p,r),(q,r if r2 is None else r2)] for i in range(n)]
  self.geo(v,[tuple(range(n-1,-1,-1)),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)],c)
 def prism(self,poly,x0,x1,c):
  n=len(poly); self.geo([(x,y,z) for x in (x0,x1) for z,y in poly],[tuple(range(n)),tuple(range(n*2-1,n-1,-1))]+[(i+n,(i+1)%n+n,(i+1)%n,i) for i in range(n)],c)
 def finish(self):
  data=bpy.data.meshes.new(self.name); data.from_pydata(self.v,[],self.f); data.update(); obj=bpy.data.objects.new(self.name,data); bpy.context.collection.objects.link(obj)
  color=data.color_attributes.new(name='Color',type='BYTE_COLOR',domain='CORNER')
  for face,c in zip(data.polygons,self.colors):
   for i in face.loop_indices: color.data[i].color=c
  mat=bpy.data.materials.new(self.name+'_vertex_paint'); mat.use_nodes=True; nodes=mat.node_tree.nodes; bsdf=nodes.get('Principled BSDF'); bsdf.inputs['Roughness'].default_value=.87; attr=nodes.new('ShaderNodeVertexColor'); attr.layer_name='Color'; mat.node_tree.links.new(attr.outputs['Color'],bsdf.inputs['Base Color']); data.materials.append(mat)
  # Stable UV channel permits optional parent material mapping.
  uv=data.uv_layers.new(name='UVMap')
  for p in data.polygons:
   for li in p.loop_indices:
    v=data.vertices[data.loops[li].vertex_index].co; uv.data[li].uv=(v.x/10.5+.5,-v.y/16+.5)
  bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); bpy.context.view_layer.objects.active=obj
  path=os.path.join(OUT,self.name+'.glb'); bpy.ops.export_scene.gltf(filepath=path,export_format='GLB',use_selection=True,export_yup=True,export_apply=True,export_attributes=False,export_texcoords=True,export_normals=True,export_materials='EXPORT')
  data.calc_loop_triangles(); coords=[(v.co.x,v.co.z,-v.co.y) for v in data.vertices]
  stats[self.name]={'file':path,'bytes':os.path.getsize(path),'triangles':len(data.loop_triangles),'meshes':1,'primitives':1,'materials':1,'bounds':{'min':[round(min(v[i] for v in coords),4) for i in range(3)],'max':[round(max(v[i] for v in coords),4) for i in range(3)]},'walkable':{'x':[-4.9,4.9],'y':.6,'z':[-8,8]},'nominal_size':[10.5,16],'axis':'glTF Y up; scale X width/10.5, Z length/16; preserve Y'}
  assert stats[self.name]['bytes']<700000,stats[self.name]
  assert stats[self.name]['triangles']<=10000
  return obj
stats={}; objects=[]
wood=(.29,.225,.148); worn=(.38,.32,.23); darkwood=(.18,.145,.09); steel=(.22,.27,.27); darksteel=(.115,.145,.15); rust=(.40,.20,.10); stone=(.28,.29,.27); rope=(.39,.345,.255)
# FROST: slender portal steel suspension with parabolic cable, hung deck and plates.
m=Mesh('bridge_suspension')
for x in [-4.45,0,4.45]: m.box((x,.24,0),(.22,.34,16),darksteel)
for i in range(40):
 z=-7.8+i*.4; m.box((0,.515,z),(9.8,.17,.382),tint(worn,.8,1.16))
 # visible pale split-grain strips, used sparsely
 if i%4==0: m.box((-1.9,.601,z+.07),(3.1,.003,.022),darkwood)
for x in [-4.98,4.98]:
 m.box((x,.31,0),(.31,.40,16),steel)
 for z in [-6.65,6.65]:
  m.box((x,-.38,z),(.54,1.55,.78),stone)
  m.box((x,3.32,z),(.40,6.15,.47),steel)
  m.box((x,6.51,z),(.52,.22,.66),darksteel)
  for y in [.85,4.95]:
   m.box((x,y,z+.25),(.47,.60,.04),darksteel)
   for dx in [-.14,.14]:
    for dy in [-.18,.18]: m.tube((x+dx,y+dy,z+.265),(x+dx,y+dy,z+.295),.034,rust,6)
 for z in [-7.75,7.75]: m.box((x,.93,z),(.43,.66,.5),stone)
 samples=[-7.92,-7.4,-6.65]+[-6.65+i*13.3/22 for i in range(1,23)]+[7.4,7.92]
 def cable(z): return 2.5+4.05*(z/6.65)**2 if abs(z)<=6.65 else 6.55-(abs(z)-6.65)*4.05
 for a,b in zip(samples,samples[1:]): m.tube((x,cable(a),a),(x,cable(b),b),.075,darksteel,6)
 for i in range(1,16):
  z=-6.65+i*13.3/16; m.tube((x,.68,z),(x,cable(z),z),.031,steel,5)
 for z in [-7.5,-5,-2.5,0,2.5,5,7.5]: m.box((x,1.14,z),(.07,1.1,.07),steel)
 for y in [1.16,1.66]: m.tube((x,y,-8),(x,y,8),.031,steel,5)
for z in [-6.65,6.65]:
 m.box((0,6.15,z),(9.9,.28,.40),steel)
 m.beam((-4.8,5.18,z),(-3.7,6.05,z),.16,steel); m.beam((4.8,5.18,z),(3.7,6.05,z),.16,steel)
objects.append(m.finish())
# AMBER: wide timber crib/trestle. Exposed rounds, diagonal braces and worn planking.
m=Mesh('bridge_timber')
for x in [-4.45,-2.2,0,2.2,4.45]: m.tube((x,.17,-8),(x,.17,8),.22,darkwood,8)
for i in range(36):
 z=-8+(i+.5)*16/36; m.box((0,.5,z),(9.8,.2,16/36-.025),tint(wood,.82,1.2))
 if i%3==0:
  m.box((-.8,.601,z-.08),(4.3,.003,.018),darkwood); m.box((2.3,.602,z+.11),(2.1,.003,.022),worn)
for z in [-6.7,-2.2,2.2,6.7]:
 m.tube((-5.15,-.15,z),(5.15,-.15,z),.25,wood,8)
 for x in [-4.6,4.6]:
  m.box((x,-1.86,z),(1.30,.65,1.05),stone)
  m.tube((x,-1.8,z),(x,-.15,z),.29,wood,8)
  m.beam((x,-1.5,z),(x*.60,-.15,z),.22,wood)
 m.beam((-4.4,-1.50,z),(4.4,-.15,z),.21,darkwood)
for x in [-4.96,4.96]:
 for z in [-7.6,-5.1,-2.55,0,2.55,5.1,7.6]:
  m.tube((x,.30,z),(x,1.65,z),.13,wood,7,r2=.10)
  m.box((x,1.1,z),(.27,.18,.29),darkwood)
 for y in [1.02,1.54]: m.tube((x,y,-8),(x,y,8),.092,wood,7)
 for a,b in [(-6.7,-2.2),(-2.2,2.2),(2.2,6.7)]:
  m.beam((x,-1.5,a),(x,-.15,b),.19,wood); m.beam((x,-.15,a),(x,-1.5,b),.19,darkwood)
objects.append(m.finish())
# SKERRY: low modular military pontoon; orange steel floats and mooring rope.
m=Mesh('bridge_pontoon'); olive=(.29,.315,.205)
m.box((0,.525,0),(9.8,.14,16),olive)
for i in range(8):
 z=-7+i*2
 for x in [-3.9,0,3.9]:
  # chamfered buoyancy capsule with tapered nose, clearly separated from deck
  poly=[(z-.96,-.55),(z-.72,-1.0),(z+.72,-1.0),(z+.96,-.55),(z+.90,.11),(z-.90,.11)]
  m.prism(poly,x-.88,x+.88,tint(rust,.82,1.1))
  for dz in [-.56,.56]: m.box((x,-.12,z+dz),(1.80,.16,.10),darksteel)
 m.box((0,.33,z),(10.30,.33,1.95),darksteel)
 for j in range(5):
  x=-3.9+j*1.95; m.box((x,.55,z),(1.91,.10,1.88),olive)
  # stamped anti-slip strips and narrow seams
  for dz in [-.56,0,.56]: m.box((x,.601,z+dz),(1.50,.006,.028),(.38,.395,.275))
 for x in [-5,5]:
  m.box((x,.67,z),(.28,.14,1.85),olive)
  m.box((x,.61,z+.80),(.44,.03,.14),rust)
  if i%2==0:
   m.box((x,.7,z),(.50,.12,.40),darksteel)
   m.tube((x,.72,z),(x,1.21,z),.12,darksteel,8)
   m.tube((x-.19,1.13,z),(x+.19,1.13,z),.07,steel,6)
 for x in [-3,3]: m.box((x,.49,z+.98),(.42,.15,.04),rust)
for x in [-5.0,5.0]:
 for a,b in [(-7,-3),(-3,1),(1,5),(5,7.75)]:
  for j in range(8):
   t=j/8; u=(j+1)/8
   m.tube((x,1.11-.31*math.sin(math.pi*t),a+(b-a)*t),(x,1.11-.31*math.sin(math.pi*u),a+(b-a)*u),.033,rope,5)
 for z in [-7,1,5]:
  # wound rope on the deck beside bollard
  for j in range(16):
   t=j*2*math.pi/16; u=(j+1)*2*math.pi/16
   m.tube((x*.91+.22*math.cos(t),.635,z+.22*math.sin(t)),(x*.91+.22*math.cos(u),.635,z+.22*math.sin(u)),.024,rope,5)
objects.append(m.finish())
# CINDER: three actual open culverts across the roadway, basalt voussoirs and spandrels.
m=Mesh('bridge_causeway'); basalt=(.255,.265,.265); mortar=(.14,.16,.16)
# deck plane including subtle gravel stone speckling
m.box((0,.46,0),(10.0,.28,16),(.335,.315,.265))
centers=[-5,0,5]; spring=-1.70; rin=1.65; rout=2.04
for center in centers:
 for i in range(12):
  a=math.pi*i/12+.006; b=math.pi*(i+1)/12-.006
  poly=[(center+rin*math.cos(a),spring+rin*math.sin(a)),(center+rout*math.cos(a),spring+rout*math.sin(a)),(center+rout*math.cos(b),spring+rout*math.sin(b)),(center+rin*math.cos(b),spring+rin*math.sin(b))]
  m.prism(poly,-5,5,tint(basalt,.9,1.2))
 # spandrel shaped strips above curved arch; no hidden opaque boxes filling aperture
 for i in range(12):
  a=math.pi*i/12; b=math.pi*(i+1)/12
  za=center+rout*math.cos(a); zb=center+rout*math.cos(b); ya=spring+rout*math.sin(a); yb=spring+rout*math.sin(b)
  m.prism([(za,ya),(za,.35),(zb,.35),(zb,yb)],-4.97,4.97,basalt)
 # vertical arch jambs below spring
 for z in [center-rin-(rout-rin)/2,center+rin+(rout-rin)/2]: m.box((0,-1.95,z),(10,.5,rout-rin-.015),basalt)
# solid piers between round arches plus end abutments
for a,b in [(-8,-7.04),(-2.96,-2.04),(2.04,2.96),(7.04,8)]:
 m.box((0,-.925,(a+b)/2),(9.94,2.55,b-a),basalt)
# outer surface masonry cladding follows holes: blocks limited above aperture crown at each z
for x in [-5.025,5.025]:
 for row in range(5):
  y=-1.94+row*.46
  for j in range(20):
   z=-7.6+j*.78+(.18 if row%2 else 0); half=.37
   if z+half>8: continue
   # only blocks entirely clear of the arch ring and culvert opening
   clear=True
   for c in centers:
    nearest=max(0,abs(z-c)-half)
    if nearest<rout and y-.20<spring+math.sqrt(max(0,rout*rout-nearest*nearest)): clear=False
   if clear: m.box((x,y,z),(.07,.425,.735),tint(basalt,.83,1.18))
 for j in range(20):
  z=-7.6+j*.8
  m.box((x,.87,z),(.39,.54,.776),tint(basalt,.85,1.18))
  m.box((x,1.19,z),(.45,.13,.792),(.36,.365,.345))
# deterministic sparse gravel, flat embedded facets in road, no obstacles
for i in range(105):
 x=random.uniform(-4.66,4.66); z=random.uniform(-7.93,7.93); r=random.uniform(.025,.075)
 m.geo([(x-r,.601,z-r*.6),(x+r,.601,z-r*.2),(x+r*.6,.601,z+r),(x-r*.5,.601,z+r*.8)],[(0,1,2,3)],(.43,.41,.34),.18)
objects.append(m.finish())
with open(os.path.join(OUT,'manifest.json'),'w') as f: json.dump(stats,f,indent=2)
# Studio setup, each export stays origin-centered; editable .blend contains all four named meshes.
world=bpy.data.worlds.new('Northern studio'); bpy.context.scene.world=world; world.use_nodes=True; world.node_tree.nodes['Background'].inputs[0].default_value=(.16,.19,.22,1); world.node_tree.nodes['Background'].inputs[1].default_value=.8
bpy.ops.object.light_add(type='AREA',location=(0,-3,18)); key=bpy.context.object; key.name='Soft daylight'; key.data.energy=2200; key.data.shape='DISK'; key.data.size=14
bpy.ops.object.light_add(type='SUN',location=(0,0,12)); sun=bpy.context.object; sun.rotation_euler=(.4,-.45,-.4); sun.data.energy=2.1; sun.data.angle=.15
bpy.ops.object.camera_add(location=(23,-26,20)); camera=bpy.context.object; target=Vector((0,0,.9)); camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler(); camera.data.type='ORTHO'; camera.data.ortho_scale=23.5; bpy.context.scene.camera=camera
scene=bpy.context.scene; scene.render.engine='CYCLES'; scene.cycles.samples=24; scene.cycles.use_denoising=True; scene.render.resolution_x=900; scene.render.resolution_y=760; scene.render.resolution_percentage=100; scene.view_settings.view_transform='AgX'; scene.render.image_settings.file_format='PNG'; scene.render.film_transparent=False
for obj in objects: obj.hide_render=True; obj.hide_set(True)
for obj in objects:
 obj.hide_render=False; obj.hide_set(False); scene.render.filepath=os.path.join(OUT,obj.name+'.png'); bpy.ops.render.render(write_still=True); obj.hide_render=True; obj.hide_set(True)
objects[0].hide_render=False; objects[0].hide_set(False)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'noordheim_crossings.blend'))
print('CROSSINGS_COMPLETE '+json.dumps(stats))
