"""Noordheim v4: weather-eroded monolithic shelves, original sculpted geometry.
Blender -b --threads 6 --python generate_environment_v4.py
Requires the adjacent v1 common mesh/UV helpers, never accesses the game checkout.
"""
from pathlib import Path
BASE=Path(__file__).resolve().parent
exec((BASE/'generate_environment.py').read_text().split("for args in [('spruce_coastal'")[0])
from mathutils import noise
OUT=BASE/'glb-v4';OUT.mkdir(exist_ok=True)
rng.seed(3857)

def ns(p,scale=1):return noise.noise_vector(Vector(p)*scale)[0]
def saturate(a):return max(0,min(1,a))
# Recorded per-face surface metadata drives continuous weathering vertex colour.
meta=[]
def weathered_mass(center,size,subdiv,seed,kind,tilt=0):
 center=Vector(center);size=Vector(size);seedvec=Vector((seed*3.7,seed*1.17,seed*.61));start=len(F)
 def sculpt(uvw):
  u=Vector(uvw)
  core=Vector(tuple(max(-.96,min(.96,v)) for v in u));edge=u-core
  direction=edge.normalized() if edge.length else Vector((0,0,1))
  rounded=core+direction*.04
  p=Vector(tuple(rounded[i]*size[i]*.5 for i in range(3)))
  # Coherent 20–35cm weathering waves, with a second smaller fractured scale.
  q=p+seedvec
  rough=ns(q,2.1)*.025+ns(q,5.8)*.014
  # Loss of whole sections of the shoulder, not small tessellation noise.
  upper=saturate((rounded.z-.30)/.7)
  loss=(.03+.05*saturate(ns(q,1.4)+.2))*upper
  horizontal=Vector((direction.x,direction.y,0))
  if horizontal.length:horizontal.normalize()
  p+=direction*rough-horizontal*loss
  # Three broad break planes are offset and stop before crossing the whole mass.
  plane=p.x+.31*p.y-.19
  fault_top=max(0,1-abs(plane)/.075)*.18*saturate((u.z+.1)*1.8)*saturate((1-abs(u.x))*7)*saturate((1-abs(u.y))*7)
  plane2=p.z-.22*p.x+.13*p.y-size.z*.02
  side_mask=saturate((-u.y+.1)*2)*saturate((u.x+.60)*1.6)
  fault_side=max(0,1-abs(plane2)/.085)*.20*side_mask*saturate((1-abs(u.x))*7)*saturate((1-abs(u.z))*7)
  plane3=p.x-.48*p.z+size.x*.29
  fault_offset=max(0,1-abs(plane3)/.075)*.16*saturate((-u.y+.2)*1.5)*saturate((u.z+.45)*2)*saturate((1-abs(u.x))*7)*saturate((1-abs(u.z))*7)
  # Deep seam recesses are 15–22cm, meaningful at RTS camera distance.
  p-=direction*(fault_top+fault_side+fault_offset)
  # Broad tilted face planes and nonuniform cap elevations, without pointed peaks.
  p.x+=p.z*.11+p.y*.045
  p.y+=p.z*tilt
  p.z+=p.x*.10-p.y*.08+ns(q,1.3)*.025
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
  weathered_mass((-.38,.12,1.10),(1.25,1.45,2.20),14,3.2 if kind=='ice' else 7.1,kind,.055)
  weathered_mass((.48,.08,.88),(1.04,1.40,1.70),10,9.1 if kind=='ice' else 13.6,kind,-.11)
  weathered_mass((-.10,-.65,.45),(1.95,.60,.75),8,18.3,kind,.06)
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
   base=PAL['rock' if kind.startswith('granite') else 'ice' if kind=='ice' else 'basalt'];factor=.90+.10*ns(q,2.7)+.06*ns(q,7.0)
   base=tuple(c*factor for c in base)
   if kind in ['ice','graniteSnow']:
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
bank('granite_1','graniteSnow',True);bank('granite_2','graniteSnow',True)
bank('granite_dry_1','granite',True);bank('granite_dry_2','granite',True)
stats={}
for ob in assets:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;ob.data.calc_loop_triangles();v=[x.co for x in ob.data.vertices]
 stats[ob['asset_name']]={'triangles':len(ob.data.loop_triangles),'bounds':{'min':[round(min(p[a] for p in v),4) for a in range(3)],'max':[round(max(p[a] for p in v),4) for a in range(3)]}}
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ob['asset_name']+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
(BASE/'asset_stats_v4.json').write_text(json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'noordheim_environment_v4.blend'))
