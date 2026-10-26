"""Noordheim v3: weather-eroded monolithic shelves, original sculpted geometry.
Blender -b --threads 6 --python generate_environment_v3.py
Requires the adjacent v1 common mesh/UV helpers, never accesses the game checkout.
"""
from pathlib import Path
BASE=Path(__file__).resolve().parent
exec((BASE/'generate_environment.py').read_text().split("for args in [('spruce_coastal'")[0])
from mathutils import noise
OUT=BASE/'glb-v3';OUT.mkdir(exist_ok=True)
rng.seed(3857)

def ns(p,scale=1):return noise.noise_vector(Vector(p)*scale)[0]
def saturate(a):return max(0,min(1,a))
# Recorded per-face surface metadata drives continuous weathering vertex colour.
meta=[]
def weathered_mass(center,size,subdiv,seed,kind,tilt=0):
 center=Vector(center);size=Vector(size);seedvec=Vector((seed*3.7,seed*1.17,seed*.61));start=len(F)
 def sculpt(uvw):
  u=Vector(uvw)
  core=Vector(tuple(max(-.80,min(.80,v)) for v in u));edge=u-core
  direction=edge.normalized() if edge.length else Vector((0,0,1))
  rounded=core+direction*.20
  p=Vector(tuple(rounded[i]*size[i]*.5 for i in range(3)))
  # Coherent 20–35cm weathering waves, with a second smaller fractured scale.
  q=p+seedvec
  rough=ns(q,2.1)*.090+ns(q,5.8)*.035
  # Loss of whole sections of the shoulder, not small tessellation noise.
  upper=saturate((rounded.z-.30)/.7)
  loss=(.09+.12*saturate(ns(q,1.4)+.2))*upper
  horizontal=Vector((direction.x,direction.y,0))
  if horizontal.length:horizontal.normalize()
  p+=direction*rough-horizontal*loss
  # Three broad break planes are offset and stop before crossing the whole mass.
  plane=p.x+.31*p.y-.19
  fault_top=math.exp(-(plane/.10)**2)*.18*saturate((u.z+.1)*1.8)*saturate((1-abs(u.x))*7)*saturate((1-abs(u.y))*7)
  plane2=p.z-.22*p.x+.13*p.y-size.z*.02
  side_mask=saturate((-u.y+.1)*2)*saturate((u.x+.60)*1.6)
  fault_side=math.exp(-(plane2/.11)**2)*.20*side_mask*saturate((1-abs(u.x))*7)*saturate((1-abs(u.z))*7)
  plane3=p.x-.48*p.z+size.x*.29
  fault_offset=math.exp(-(plane3/.10)**2)*.16*saturate((-u.y+.2)*1.5)*saturate((u.z+.45)*2)*saturate((1-abs(u.x))*7)*saturate((1-abs(u.z))*7)
  # Deep seam recesses are 15–22cm, meaningful at RTS camera distance.
  p-=direction*(fault_top+fault_side+fault_offset)
  # Broad tilted face planes and nonuniform cap elevations, without pointed peaks.
  p.x+=p.z*.11+p.y*.045
  p.y+=p.z*tilt
  p.z+=p.x*.10-p.y*.08+ns(q,1.3)*.075
  return center+p, max(fault_top,fault_side,fault_offset)
 # Six subdivided sculpt patches share identical edge positions. Smoothing is
 # restricted to each major face, retaining its fracture-plane boundary.
 for axis,sign in [(0,1),(0,-1),(1,1),(1,-1),(2,1),(2,-1)]:
  other=[i for i in range(3) if i!=axis];patch=[];fault=[]
  for j in range(subdiv+1):
   for k in range(subdiv+1):
    uv=[0,0,0];uv[axis]=sign;uv[other[0]]=-1+2*k/subdiv;uv[other[1]]=-1+2*j/subdiv
    p,g=sculpt(uv);patch.append(p);fault.append(g)
  faces=[]
  for j in range(subdiv):
   for k in range(subdiv):
    a=j*(subdiv+1)+k;face=(a,a+1,a+subdiv+2,a+subdiv+1)
    n=(patch[face[1]]-patch[face[0]]).cross(patch[face[2]]-patch[face[0]])
    if n[axis]*sign<0:face=tuple(reversed(face))
    faces.append(face)
  base=len(V)
  add(patch,faces,'ice' if kind=='ice' else 'basalt',0)
  for face in faces:meta.append({'indices':[base+index for index in face],'fault':[fault[index] for index in face],'kind':kind,'seed':seed,'center':center.copy(),'height':size.z,'axis':axis,'sign':sign})

def bank(name,kind,scree=False):
 global meta
 # One dominant crooked monolith carries most of the silhouette. Only two
 # subordinate detached ledges remain, instead of seven equal polygon columns.
 if not scree:
  weathered_mass((-.16,.13,1.12),(1.85,1.50,2.23),14,3.2 if kind=='ice' else 7.1,kind,.055)
  weathered_mass((.60,-.18,.68),(.93,1.21,1.25),10,9.1 if kind=='ice' else 13.6,kind,-.11)
  weathered_mass((-.36,-.63,.35),(1.56,.70,.65),8,18.3,kind,.06)
  weathered_mass((.73,-.68,.13),(.65,.48,.29),5,5.2,kind,.12)
 else:
  weathered_mass((-.17,.05,.35),(1.85,1.14,.76),14,3.2 if kind=='ice' else 7.1,kind,.04)
  weathered_mass((.65,-.12,.21),(.84,.84,.44),10,9.1 if kind=='ice' else 13.6,kind,-.13)
  weathered_mass((-.32,-.45,.11),(1.52,.63,.28),8,18.3,kind,.04)
  weathered_mass((.68,-.55,.08),(.60,.38,.18),5,5.2,kind,.09)
 # Artist-authored material masks follow slope, erosion seams, and snow pockets.
 # Save unscaled positions because the final origin/bounds fit is affine.
 original_vertices=[p.copy() for p in V]
 ob=finalize(name);attr=ob.data.color_attributes['Col']
 for poly in ob.data.polygons:poly.use_smooth=True
 ob.data.update()
 for poly,info in zip(ob.data.polygons,meta):
  poly.use_smooth=True
  for loop,vi,fault in zip(poly.loop_indices,info['indices'],info['fault']):
   p=original_vertices[vi];q=p+Vector((info['seed'],info['seed']*.3,0));n=ob.data.vertices[vi].normal
   # Cold mineral faces stay varied, but caps are irregular aged snow islands.
   base=PAL['ice' if kind=='ice' else 'basalt'];factor=.90+.10*ns(q,2.7)+.06*ns(q,7.0)
   base=tuple(c*factor for c in base)
   if kind=='ice':
    capmask=saturate((n.z-.28)/.45)*saturate((p.z-info['center'].z)/max(.05,info['height']*.27))
    snowfield=saturate((ns(q,2.3)+.35)*2.5)
    # Wind scours the right lip; deposits remain in broad hollows and ledges.
    snowmask=capmask*snowfield*(1-saturate(fault/.10))
    base=tuple(base[c]*(1-snowmask)+PAL['snow'][c]*snowmask for c in range(3))
   elif n.z>.6:
    capmask=saturate((ns(q,2)+.03)*.4)
    base=tuple(base[c]*(1-capmask)+PAL['lichen'][c]*capmask for c in range(3))
   dark=saturate(fault/.16)*.60
   shade=PAL['blueice' if kind=='ice' else 'rockdark']
   color=tuple(base[c]*(1-dark)+shade[c]*dark*.48 for c in range(3))
   attr.data[loop].color=color+(1,)
 meta=[]

bank('glacial_spires','ice');bank('glacial_scree','ice',True)
bank('basalt_columns','basalt');bank('basalt_scree','basalt',True)
stats={}
for ob in assets:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;ob.data.calc_loop_triangles();v=[x.co for x in ob.data.vertices]
 stats[ob['asset_name']]={'triangles':len(ob.data.loop_triangles),'bounds':{'min':[round(min(p[a] for p in v),4) for a in range(3)],'max':[round(max(p[a] for p in v),4) for a in range(3)]}}
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ob['asset_name']+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
(BASE/'asset_stats_v3.json').write_text(json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'noordheim_environment_v3.blend'))

sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=48;sc.cycles.use_denoising=True
sc.render.resolution_x=1600;sc.render.resolution_y=880;sc.render.resolution_percentage=100;sc.view_settings.view_transform='AgX'
sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.42,.48,1);sc.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for idx,ob in enumerate(assets):
 scale=2.9/max(ob.dimensions);ob.scale=(scale,)*3;ob.location=((idx-1.5)*3.9,0,.04)
 bpy.ops.object.text_add(location=(ob.location.x-1.40,-1.55,.015));t=bpy.context.object;t.data.body=ob['asset_name'];t.data.size=.23
 m=bpy.data.materials.get('label') or bpy.data.materials.new('label');m.diffuse_color=(.7,.76,.75,1);t.data.materials.append(m)
bpy.ops.mesh.primitive_plane_add(size=200);g=bpy.context.object;g.location.z=-.02;m=bpy.data.materials.new('ground');m.diffuse_color=(.04,.05,.05,1);g.data.materials.append(m)
for loc,power,size in [((-6,-7,14),2100,8),((9,8,12),1700,8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-13,12));cam=bpy.context.object;cam.rotation_euler=(Vector((0,0,.8))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=17.0;sc.camera=cam
sc.render.filepath=str(BASE/'contact_sheet_v3.png');bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'contact_sheet_v3.blend'));bpy.ops.render.render(write_still=True)
