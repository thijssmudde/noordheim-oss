"""Noordheim authored fractured geology. Blender 4.5+; no external dependencies/assets.
Run: Blender --background --threads 6 --python generate_geology.py
All rocks are one opaque mesh / primitive / material with vertex colors and UVs.
The editable scene stores anchored assets, a labeled studio and close-up cameras.
"""
import bpy, math, random, json, struct
from pathlib import Path
from mathutils import Vector, noise
P=Path(__file__).resolve().parent
OUT=P/'glb';OUT.mkdir(exist_ok=True)
ORIG=json.loads((P/'original_stats.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def rgb(h):
 a=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in a)
COL={k:rgb(v) for k,v in {'ice':'91aab1','iceFresh':'78949e','iceDark':'314b59','snow':'cbd8d8','snowShade':'9eafb5','basalt':'404744','basaltFresh':'555d58','basaltDark':'222b2b','granite':'717b76','graniteFresh':'90948a','graniteDark':'36423e','lichen':'727d50'}.items()}
mat=bpy.data.materials.new('Fractured geology | mineral and snow vertex colors');mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.96
bs.inputs['Specular IOR Level'].default_value=.22
vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Col';mat.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
mat.diffuse_color=(*COL['granite'],1)
V=[];F=[];C=[];SM=[];TOP=[];ASSETS=[]
def sat(x):return max(0,min(1,x))
def ns(p,s=1):return noise.noise_vector(Vector(p)*s)[0]
def mix(a,b,t):return tuple(x*(1-t)+y*t for x,y in zip(a,b))
def patch(verts,faces,colors,smooth=True,top=False):
 n=len(V);V.extend(verts)
 for f in faces:F.append(tuple(n+i for i in f));C.append([colors[i] for i in f]);SM.append(smooth);TOP.append(top)
def radial_patch(vv,ff,cc,n):
 # Delaunay triangulation removes radial strips and their pinched shading.
 # Ring points are only samples; their radial construction is not retained.
 from mathutils.geometry import delaunay_2d_cdt
 newv=[vv[0]]+vv[n:];newc=[cc[0]]+cc[n:]
 boundary=list(range(len(newv)-n,len(newv)))
 edges=[(boundary[i],boundary[(i+1)%n]) for i in range(n)]
 coords=[Vector((v.x,v.y)) for v in newv]
 pts,ed,faces,origv,orige,origf=delaunay_2d_cdt(coords,edges,[boundary],1,0.000001)
 verts=[];colors=[]
 for p,ids in zip(pts,origv):
  idx=ids[0] if ids else min(range(len(coords)),key=lambda i:(coords[i]-p).length_squared)
  verts.append(newv[idx]);colors.append(newc[idx])
 patch(verts,faces,colors,True,True)
def mineral(p,kind,depth=0,seed=0,top=False):
 q=Vector(p)+Vector((seed,seed*.6,seed*.2))
 # Coherent large fracture coloration, fine grain and lichen pockets are baked.
 grain=.91+.25*ns(q,5.9)+.22*ns(q,23)+.13*ns(q,61)
 base=tuple(c*grain for c in COL[kind])
 fresh=sat((ns(q,2.8)-.13)*1.2)
 base=mix(base,COL[kind+'Fresh'],fresh*.42)
 if kind!='ice' and top:base=mix(base,COL['lichen'],sat((ns(q,7)-.08)*.4))
 return mix(base,COL[kind+'Dark'],sat(depth)*.88)
# The perimeter is explicitly authored as uneven fracture planes, not a sphere
# or perturbed cube. The first five faces make five unequal front fracture planes.
SLAB=[(-.68,-.30),(-.55,-.55),(-.29,-.61),(-.11,-.51),(.18,-.65),(.48,-.49),(.62,-.19),(.56,.42),(.19,.55),(-.25,.49),(-.61,.30)]
RUBBLE=[(-.72,-.24),(-.47,-.57),(.05,-.54),(.36,-.30),(.64,-.05),(.34,.36),(-.13,.55),(-.55,.29)]
def mass(center,size,kind,seed,outline=None,snow=False,detail=1,lean=(.08,-.06),capbreak=.0):
 """A continuous volume with real V-cut seams; topology follows the fissures.
 Side patches have a shear fracture and branching vertical breaks. Fine relief
 remains within each large plane; normals split at authored perimeter corners.
 """
 rr=random.Random(seed);center=Vector(center);sx,sy,sz=size
 outline=outline or SLAB
 # Each perimeter corner gets a different shoulder height and shear.
 n=len(outline);rot=rr.uniform(-.16,.16)
 outline=[Vector(((x*math.cos(rot)-y*math.sin(rot))*sx,(x*math.sin(rot)+y*math.cos(rot))*sy,0)) for x,y in outline]
 topz=[sz*(.95+.09*ns((p.x+seed,p.y,0),2)+.09*p.x/max(sx,.1)-.075*p.y/max(sy,.1)) for p in outline]
 # fissure center positions vary continuously around the entire mass.
 cross=[.43+.13*math.sin(j*1.39+seed)+.04*math.cos(j*3.2) for j in range(n)]
 # Perimeter profile, with large oblique breaks rather than uniform taper.
 def contour(p,t,zt):
  scale=1.03-.16*t+.025*math.sin(t*3.8)
  return center+Vector((p.x*scale+lean[0]*sz*t+p.y*.065*math.sin(t*4),p.y*scale+lean[1]*sz*t+p.x*.04*math.sin(t*5),zt*t))
 tops=[];top_samples=[]
 for j in range(n):
  a=outline[j];b=outline[(j+1)%n];zt0=topz[j];zt1=topz[(j+1)%n]
  edge=(b-a);normal=Vector((edge.y,-edge.x,0)).normalized()
  # Broad faces have adaptive seam strips and extra branch topology.
  us=[0,.14,.32,.43,.48,.5,.52,.58,.76,1] if detail else [0,.31,.48,.5,.52,.75,1]
  ts=[0,.18,.34,.475,.5,.525,.68,.85,1] if detail else [0,.28,.475,.5,.525,.78,1]
  vv=[];cc=[]
  for t in ts:
   for u0 in us:
    # Main break bends abruptly and branches at the oblique cross-fracture.
    bend=(.13*math.sin(t*4+seed*.3)+.08*(t>.5))*math.sin(math.pi*u0)
    u=u0+bend
    f=cross[j]*(1-u)+cross[(j+1)%n]*u
    if t<=.475:z=t/.475*(f-.014)
    elif t<=.525:z=f+(t-.5)*.014/.025
    else:z=f+.014+(t-.525)/.475*(1-f-.014)
    p0=a.lerp(b,u);zt=zt0*(1-u)+zt1*u
    p=contour(p0,z,zt)
    crossdepth=max(0,1-abs(t-.5)/.025)*(.025 if kind=='basalt' else .045)*min(sx,sy)*(1 if j in (1,2,3,4) else .13)
    # Three primary front seams; all other seams taper or stop before the crest.
    active=1 if j in (1,3) else 0
    vertical=max(0,1-abs(u0-.5)/.027)*(.07 if kind=='ice' else .045)*min(sx,sy)*active
    vertical*=sat(z*8)*sat((1-z)*12)
    # Branch widens below the crossing and becomes a separate fracture plane.
    p-=normal*(crossdepth+vertical)
    if detail:
     chipped=max(0,1-abs(u0-(.32 if j%3 else .76))/.10)*sat((z-.77)/.23)*(1 if j%3!=2 else .15)
     p-=normal*chipped*.035*min(sx,sy)
     p.z-=chipped*.045*min(sx,sy)
    border=math.sin(math.pi*u)*math.sin(math.pi*z)
    p+=normal*(ns(p+Vector((seed,0,0)),12)*.007+ns(p,31)*.002)*border
    vv.append(p);cc.append(mineral(p,kind,(crossdepth+vertical)/(.065*min(sx,sy)),seed))
  ff=[];w=len(us)
  for row in range(len(ts)-1):
   for col in range(w-1):
    aidx=row*w+col;ff.append((aidx,aidx+1,aidx+w+1,aidx+w))
  patch(vv,ff,cc,True)
  tops.append(contour(outline[j],1,topz[j]));top_samples.extend(vv[-w:-1])
 # An irregular, densely chipped top contour. Small edge cuts subdivide each
 # major corner without replacing the large-scale fracture planes.
 rim=[]
 for j in range(n):
  for k in range(3 if detail else 1):
   t=k/(3 if detail else 1);p=tops[j].lerp(tops[(j+1)%n],t)
   # Rim samples stay on the side boundary; roughness starts inside the rim.
   rim.append(p)
 if detail:rim=top_samples
 N=len(rim);tc=sum(tops,Vector())/len(tops);tc.z+=sz*.018
 def top_point(p,r,j):
  q=tc.lerp(p,r)
  base=tc.z+(q.x-tc.x)*.07-(q.y-tc.y)*.04
  edgeplane=tc.z+(p.x-tc.x)*.07-(p.y-tc.y)*.04
  q.z=base+(p.z-edgeplane)*sat((r-.70)/.30)+.035*min(sx,sy)*(1-r*r)
  q.z+=(ns(q+Vector((seed,0,0)),8)*.008+ns(q,23)*.003)*math.sin(math.pi*r)
  # Uneven oblique fracture cleft, closed at both ends, crosses upper planes.
  line=q.x-center.x+.41*(q.y-center.y)-sx*.13
  cleft=max(0,1-abs(line)/(.042*sx))*sat((1-r)*5)
  q.z-=cleft*.038*min(sx,sy)
  return q,cleft
 rings=([0,.34,.69,1] if detail else [0,.46,1]);vv=[];cc=[]
 for r in rings:
  for j,p in enumerate(rim):
   q,depth=top_point(p,r,j);vv.append(q);cc.append(mineral(q,kind,depth*.55,seed,True))
 ff=[]
 for k in range(len(rings)-1):
  for j in range(N):ff.append((k*N+j,(k+1)*N+j,(k+1)*N+(j+1)%N,k*N+(j+1)%N))
 radial_patch(vv,ff,cc,N)
 patch([center+Vector((p.x,p.y,-.015)) for p in outline],[tuple(reversed(range(n)))],[COL[kind+'Dark']]*n,False)
 if snow:
  # Scalloped, chipped snow margins follow the rock but are individually eroded.
  # Wind-cut thin patches expose mineral naturally, without wedge cutouts.
  vv=[];cc=[];R=([0,.33,.71,1] if detail else [0,.49,1])
  for k,r in enumerate(R):
   for j,p in enumerate(rim):
    inset=.88+.07*ns(p+Vector((seed,0,0)),5)+.025*ns(p,13)
    q,cleft=top_point(p,r*inset,j)
    grain=ns(q+Vector((seed,0,0)),19)
    deposit=sat(.62+ns(q+Vector((seed,0,0)),4)*1.3)
    thick=(.019+.066*deposit)*min(1,sx)
    q.z+=max(.002,(thick*(1 if r<1 else .045))*(1-cleft*.96))+.009*grain*math.sin(math.pi*r)
    shade=sat(.38-grain)*.27+(0.08 if r==1 else 0)
    c=mix(COL['snow'],COL['snowShade'],shade)
    # The narrow top fracture remains visible through thin snow cover.
    c=mix(c,COL[kind+'Fresh'],cleft*.67)
    vv.append(q);cc.append(c)
  ff=[]
  for k in range(len(R)-1):
   for j in range(N):ff.append((k*N+j,(k+1)*N+j,(k+1)*N+(j+1)%N,k*N+(j+1)%N))
  radial_patch(vv,ff,cc,N)

def finish(name):
 global V,F,C,SM,TOP
 target=ORIG[name];lo=[min(v[a] for v in V) for a in range(3)];hi=[max(v[a] for v in V) for a in range(3)]
 verts=[tuple(target['min'][a]+(p[a]-lo[a])/(hi[a]-lo[a])*(target['max'][a]-target['min'][a]) for a in range(3)) for p in V]
 me=bpy.data.meshes.new(name+'__authored_fractures');me.from_pydata(verts,[],F);me.materials.append(mat);me.update()
 ob=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(ob)
 col=me.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER');uv=me.uv_layers.new(name='UVMap')
 for face,colors,sm in zip(me.polygons,C,SM):
  face.use_smooth=sm
  axis=max(range(3),key=lambda a:abs(face.normal[a]));axes=[a for a in range(3) if a!=axis]
  for li,c in zip(face.loop_indices,colors):
   col.data[li].color=(*c,1);p=me.vertices[me.loops[li].vertex_index].co;uv.data[li].uv=(p[axes[0]],p[axes[1]])
 # Top normals are weighted toward the underlying broad fracture plane;
 # tiny chipped topology must not create spoke-like interpolation artifacts.
 me.update()
 normals=[x.vector.copy() for x in me.corner_normals]
 for face,is_top in zip(me.polygons,TOP):
  if is_top:
   for li in face.loop_indices:
    normals[li]=(normals[li]*.16+Vector((-.07,.04,1))*.84).normalized()
 me.normals_split_custom_set(normals)
 ob['asset_name']=name;ob['art_family']='Noordheim sculpted fracture revision';ob['ambient_only']=True
 ob['geometry_note']='Authored multi-plane outline, deep topology-aligned branching and shear fissures, irregular geometric snow crust'
 ASSETS.append(ob);V=[];F=[];C=[];SM=[];TOP=[]
 return ob

def talus(kind,seed,snow=False):
 rr=random.Random(seed)
 for j in range(5):
  a=j*2.39+.3;mass((math.cos(a)*.78,math.sin(a)*.47,.025),(.28+rr.random()*.13,.23+rr.random()*.12,.13+rr.random()*.13),kind,seed+j,RUBBLE,snow and j%2==0,0,lean=(.12,-.12))

# Two interlocked, staggered major slabs retain the established hero silhouette.
mass((-.42,.12,.05),(1.02,1.30,2.1),'ice',32,snow=True)
mass((.49,.17,.035),(.94,1.17,1.68),'ice',67,snow=True,lean=(-.07,.04))
mass((-.07,-.40,0),(1.55,.74,.39),'ice',21,RUBBLE,True,0)
finish('glacial_spires')
# A continuous split ridge, with neighboring volumes intersecting below fractures.
mass((-.3,.03,0),(1.35,1.01,.65),'ice',44,snow=True,lean=(.14,.03))
mass((.42,-.03,.0),(.89,.92,.48),'ice',38,RUBBLE,True,0,lean=(-.08,.12))
mass((-.17,-.37,0),(1.43,.50,.21),'ice',17,RUBBLE,True,0)
finish('glacial_scree')
# Irregular columnar basalt: 9 six-sided columns, unequal heights, rough shear
# breaks and dark clefts. A buried fractured footing visually joins the bundle.
rr=random.Random(93)
for j,(x,y,r,h) in enumerate([(-.48,.25,.38,1.82),(.10,.29,.36,2.10),(.64,.19,.33,1.57),(-.76,-.15,.28,.94),(-.24,-.31,.34,1.44),(.35,-.29,.34,1.68),(.76,-.30,.24,.80),(-.38,-.76,.26,.65),(.19,-.78,.27,.85)]):
 poly=[(math.cos(k*math.tau/6+.15)*rr.uniform(.93,1.05),math.sin(k*math.tau/6+.15)*rr.uniform(.93,1.05)) for k in range(6)]
 mass((x,y,0),(r,r,h),'basalt',100+j,poly,False,0,lean=(rr.uniform(-.03,.04),rr.uniform(-.03,.03)))
mass((0,-.1,-.015),(1.57,1.1,.23),'basalt',68,RUBBLE,False,0)
finish('basalt_columns')
# Fallen basalt retains chunky jointed geometry rather than rounded pebbles.
for j,(x,y,sx,sy,h) in enumerate([(-.28,.10,1.02,.93,.54),(.37,.14,.78,.61,.42),(-.32,-.35,.8,.46,.29),(.48,-.30,.61,.46,.27)]):mass((x,y,0),(sx,sy,h),'basalt',135+j,RUBBLE,False,j==0,lean=(.25,-.14))
talus('basalt',55)
finish('basalt_scree')
for variant in (1,2):
 for dry in (False,True):
  seed=291+variant*27
  mass((-.18,.08,.0),(1.49,1.13,.76),'granite',seed,SLAB if variant==1 else RUBBLE,not dry,1,lean=(.22 if variant==1 else -.16,-.13))
  mass((.45,-.29,0),(.78,.61,.35),'granite',seed+9,RUBBLE,not dry,0)
  talus('granite',seed+22,not dry)
  finish('granite_'+('dry_' if dry else '')+str(variant))

stats={}
for ob in ASSETS:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;me=ob.data;me.calc_loop_triangles()
 lo=[min(v.co[a] for v in me.vertices) for a in range(3)];hi=[max(v.co[a] for v in me.vertices) for a in range(3)]
 assert len(me.loop_triangles)<6500,(ob.name,len(me.loop_triangles))
 assert max(abs(lo[a]-ORIG[ob.name]['min'][a]) for a in range(3))<1e-6
 assert max(abs(hi[a]-ORIG[ob.name]['max'][a]) for a in range(3))<1e-6
 fp=OUT/(ob.name+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(fp),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
 raw=fp.read_bytes();n=struct.unpack_from('<I',raw,12)[0];gl=json.loads(raw[20:20+n]);assert len(gl['meshes'])==1 and len(gl['meshes'][0]['primitives'])==1 and len(gl['materials'])==1
 stats[ob.name]={'triangles':len(me.loop_triangles),'vertices':len(me.vertices),'bounds_blender_xyz':{'min':lo,'max':hi},'mesh_count':1,'primitive_count':1,'material_count':1,'bytes':len(raw),'uv':'UVMap','colors':'Col','roughness':.96,'pivot':[0,0,0]}
(P/'asset_stats.json').write_text(json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(P/'noordheim_geology.blend'))
# Studio instances leave source assets anchored at origin in an editable collection.
source=bpy.data.collections.new('SOURCE | anchored one-mesh assets');bpy.context.scene.collection.children.link(source)
for ob in ASSETS:
 for coll in list(ob.users_collection):coll.objects.unlink(ob)
 source.objects.link(ob);ob.hide_render=True;ob.hide_set(True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1800;scene.render.resolution_y=1300;scene.render.resolution_percentage=100
scene.world.use_nodes=True;bg=scene.world.node_tree.nodes['Background'];bg.inputs[0].default_value=(.43,.49,.54,1);bg.inputs[1].default_value=.45
scene.view_settings.view_transform='AgX'
for i,ob in enumerate(ASSETS):
 du=ob.copy();du.data=ob.data;bpy.context.collection.objects.link(du);du.hide_render=False;du.hide_set(False)
 scale=2.65/max(ob.dimensions);du.scale=(scale,)*3;du.location=((i%4-1.5)*3.6,(i//4-.5)*4.0,.05-min(v.co.z for v in ob.data.vertices)*scale)
 bpy.ops.object.text_add(location=(du.location.x-1.4,du.location.y-1.30,.03));tx=bpy.context.object;tx.data.body=ob.name;tx.data.size=.20
 ink=bpy.data.materials.get('Studio ink') or bpy.data.materials.new('Studio ink');ink.diffuse_color=(.62,.68,.7,1);tx.data.materials.append(ink)
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.location.z=-.02
m=bpy.data.materials.new('Studio ground');m.diffuse_color=(.045,.055,.06,1);ground.data.materials.append(m)
for pos,power,size in [((-7,-8,12),2000,7),((6,4,9),1400,6)]:
 bpy.ops.object.light_add(type='AREA',location=pos);ob=bpy.context.object;ob.data.energy=power;ob.data.shape='DISK';ob.data.size=size;ob.rotation_euler=(Vector((0,0,0))-ob.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-13,16));cam=bpy.context.object;cam.rotation_euler=(Vector((0,.5,.5))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=15.4;scene.camera=cam
scene.render.filepath=str(P/'contact_sheet.png');bpy.ops.wm.save_as_mainfile(filepath=str(P/'geology_studio.blend'));bpy.ops.render.render(write_still=True)
print('COMPLETE',json.dumps({k:v['triangles'] for k,v in stats.items()}))
