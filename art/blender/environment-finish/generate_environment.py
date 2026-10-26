"""Noordheim authored environment revision. Blender 4.5+, no downloaded geometry.
Generate: Blender --background --threads 4 --python generate_environment.py
One mesh, one vertex-colour material, metric projection UVs, grounded origins.
"""
import bpy, bmesh, math, random, json
from pathlib import Path
from mathutils import Vector
P=Path(__file__).resolve().parent
SRC=P/'source_props'
OUT=P/'glb';OUT.mkdir(exist_ok=True)
ORIGINAL=json.loads((P/'original_stats.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
rng=random.Random(30477)
mat=bpy.data.materials.new('Noordheim opaque organic surfaces — texture ready');mat.use_nodes=True
bs=mat.node_tree.nodes.get('Principled BSDF');bs.inputs['Roughness'].default_value=.89
vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Col';mat.node_tree.links.new(vc.outputs['Color'],bs.inputs['Base Color'])
mat.diffuse_color=(.25,.30,.25,1)
# Artists may multiply image albedo into Col and add tangent normals through UVMap.
mat['texture_coordinates']='UVMap: dominant-axis metric projection; object/world triplanar supported'

def rgb(h):
 c=[int(h[i:i+2],16)/255 for i in (0,2,4)]
 return tuple(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4 for x in c)
PAL={k:rgb(h) for k,h in {'bark':'65584a','twig':'595749','needle':'36533d','needle2':'4d6448','tip':'647655','snow':'d7dfda','deep':'293e32','amber':'af853e','gold':'c69e4b','russet':'966639','pale':'c7c7b3','scar':'575c50','rock':'7f8884','rockdark':'505b57','lichen':'8c9873','basalt':'505954','ice':'8eaeb4','blueice':'627f86','reeds':'8d8854','steel':'56605f','wood':'837461','joint':'363b36','rust':'83634b'}.items()}
V=[];F=[];C=[];assets=[]
def add(v,f,col,variation=.06):
 n=len(V);V.extend(Vector(x) for x in v)
 col=PAL.get(col,col)
 for face in f:
  F.append(tuple(n+i for i in face));fct=rng.uniform(1-variation,1+variation)
  C.append(tuple(x*fct for x in col))
def beam(a,b,r,col='bark',r2=None,sides=6):
 a,b=Vector(a),Vector(b);axis=(b-a).normalized();cross=axis.cross(Vector((0,0,1)))
 if cross.length<.01:cross=axis.cross(Vector((0,1,0)))
 cross.normalize();other=axis.cross(cross).normalized();r2=r*.64 if r2 is None else r2
 v=[point+(cross*math.cos(j*math.tau/sides)+other*math.sin(j*math.tau/sides))*rad for point,rad in [(a,r),(b,r2)] for j in range(sides)]
 f=[(j,(j+1)%sides,(j+1)%sides+sides,j+sides) for j in range(sides)]+[tuple(reversed(range(sides))),tuple(range(sides,2*sides))]
 add(v,f,col)
def box(c,s,col):
 x,y,z=c;w,d,h=[k/2 for k in s]
 add([(x+a*w,y+b*d,z+e*h) for a,b,e in [(-1,-1,-1),(1,-1,-1),(1,1,-1),(-1,1,-1),(-1,-1,1),(1,-1,1),(1,1,1),(-1,1,1)]],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)],col)
def spray(c,angle,length,width,col='needle',snow=False):
 # Closed, tapered, serrated needle fan. Its ridgeline droops then turns upward.
 c=Vector(c);d=Vector((math.cos(angle),math.sin(angle),0));s=Vector((-d.y,d.x,0));n=7
 v=[]
 for j in range(n):
  t=j/(n-1);center=c+d*length*t+Vector((0,0,length*(-.20*math.sin(math.pi*t)+.06*t)))
  w=width*math.sin(math.pi*(.06+.90*t))*(.58 if j%2 else 1.0)
  v.extend([center-s*w,center+Vector((0,0,width*.20)),center+s*w,center-Vector((0,0,width*.10))])
 f=[]
 for j in range(n-1):
  a=j*4;b=a+4;f.extend([(a,b,b+1,a+1),(a+1,b+1,b+2,a+2),(a+2,b+2,b+3,a+3),(a+3,b+3,b,a)])
 f.extend([(0,1,2,3),(24,27,26,25)])
 add(v,f,col)
 if snow:
  # Snow follows only the central upper ridge; the needled margin stays visible.
  vv=[]
  for j in range(1,n-1):
   for a in (0,1,2):vv.append(v[4*j+1].lerp(v[4*j+a],.58)+Vector((0,0,.012)))
  add(vv,[(j*3,j*3+3,j*3+4,j*3+1) for j in range(n-3)]+[(j*3+1,j*3+4,j*3+5,j*3+2) for j in range(n-3)],'snow',.025)
def leaf(c,a,l,col):
 c=Vector(c);d=Vector((math.cos(a),math.sin(a),rng.uniform(-.25,.35)));s=Vector((-math.sin(a),math.cos(a),rng.uniform(-.55,.55)))
 v=[c-d*l*.5,c+s*l*.32,c+d*l*.60,c-s*l*.32,c+Vector((0,0,l*.14)),c-Vector((0,0,.006))]
 add(v,[(0,1,4),(1,2,4),(2,3,4),(3,0,4),(0,5,1),(1,5,2),(2,5,3),(3,5,0)],col,.10)
def finalize(name,fit=True):
 global V,F,C
 if fit:
  # Preserve the asset pack's metre dimensions and original anchored pivot.
  old=ORIGINAL[name];mins=[min(v[a] for v in V) for a in range(3)];maxs=[max(v[a] for v in V) for a in range(3)]
  V=[Vector(tuple(old['min'][a]+(v[a]-mins[a])/(maxs[a]-mins[a])*(old['max'][a]-old['min'][a]) for a in range(3))) for v in V]
 me=bpy.data.meshes.new(name+'_geometry');me.from_pydata(V,[],F);me.update()
 obj=bpy.data.objects.new(name,me);bpy.context.collection.objects.link(obj);me.materials.append(mat)
 attr=me.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='CORNER')
 uv=me.uv_layers.new(name='UVMap')
 for poly,col in zip(me.polygons,C):
  normal=poly.normal;axis=max(range(3),key=lambda a:abs(normal[a]));axes=[a for a in range(3) if a!=axis]
  for i in poly.loop_indices:
   attr.data[i].color=tuple(max(0,min(.99,x)) for x in col)+(1,)
   co=me.vertices[me.loops[i].vertex_index].co;uv.data[i].uv=(co[axes[0]],co[axes[1]])
 obj['asset_name']=name;obj['ambient_only']=True;obj['art_family']='Noordheim fractured boreal environment';obj['geometry_note']='Original custom authored geometry, opaque silhouettes, one draw-call compatible'
 if name.startswith(('spruce','juniper','birch')) and not name.endswith('_lod'):
  bpy.context.view_layer.objects.active=obj;obj.select_set(True)
  dec=obj.modifiers.new('RTS silhouette reduction','DECIMATE');dec.ratio=(5700/sum(len(p.vertices)-2 for p in obj.data.polygons)) if name.startswith(('spruce','birch')) else .48
  bpy.ops.object.modifier_apply(modifier=dec.name)
  if fit:
   target=ORIGINAL[name];lo=[min(v.co[a] for v in obj.data.vertices) for a in range(3)];hi=[max(v.co[a] for v in obj.data.vertices) for a in range(3)]
   for v in obj.data.vertices:
    for a in range(3):v.co[a]=target['min'][a]+(v.co[a]-lo[a])/(hi[a]-lo[a])*(target['max'][a]-target['min'][a])
   obj.data.update()
 assets.append(obj);V=[];F=[];C=[]
 return obj

def spruce(name,height,lean,full,snow):
 def axis(z):return Vector((lean*(z/height)**1.7,math.sin(z*1.9)*.025,z))
 for j in range(9):beam(axis(j*height/9),axis((j+1)*height/9),.105*(1-j/10)**1.4+.008,'bark',sides=7)
 for level in range(10):
  z=.45+level*(height-.67)/10;extent=full*(1-z/height)**.78
  count=6 if level<6 else 5
  for j in range(count):
   a=j*math.tau/count+level*2.399+rng.uniform(-.21,.21);r=extent*rng.uniform(.80,1.08)
   root=axis(z+rng.uniform(-.07,.07));end=root+Vector((math.cos(a)*r,math.sin(a)*r,-.10*r))
   mid=root.lerp(end,.55)+Vector((0,0,-.09*r));beam(root,mid,.028*(1-z/height)+.008,'twig');beam(mid,end,.016*(1-z/height)+.003,'twig',sides=5)
   # Lateral branchlets silhouette out of the crown, yielding fine gaps at every tier.
   for q in range(4):
    t=.28+q*.19;p=root.lerp(end,t)+Vector((0,0,-.05*r))
    for side in (-1,1):
     aa=a+side*rng.uniform(.60,.95);length=r*(.34-.045*q)*rng.uniform(.8,1.15)+.03
     spray(p,aa,length,length*.27,'needle2' if (q+j+level)%5==0 else 'needle',snow and level%3!=0 and (q+j)%3==0)
   spray(end,a,r*.20+.06,r*.07+.015,'tip',snow and level%2==0)
 # A sparse, visible terminal leader avoids a blunt cap.
 for j in range(5):spray(axis(height-.28+j*.052),j*2.4,.16-j*.02,.038,'needle2',False)
 finalize(name)
for args in [('spruce_coastal',3.8,.16,1.25,True),('spruce_windswept',3.4,.44,1.35,True),('spruce_young',2.7,-.08,.85,True),('spruce_dry',3.8,.16,1.25,False)]:spruce(*args)

def birch(name,lean,col):
 def axis(z):return Vector((lean*(z/3.8)**1.5,.03*math.sin(z*2),z))
 for j in range(13):
  z=j*3.65/13;beam(axis(z),axis(z+3.65/13),.095*(1-j/15)+.007,'pale',sides=8)
 # Short scars wrap sections of the actual bark, with varying width and height.
 for j in range(30):
  z=rng.uniform(.15,3.1);r=.102*(1-z/4.25);a=rng.uniform(0,math.tau);span=rng.uniform(.25,.8);v=[]
  for dz in (0,rng.uniform(.013,.033)):
   for t in range(4):
    aa=a+(t/3-.5)*span;v.append(axis(z)+Vector((math.cos(aa)*(r+.003),math.sin(aa)*(r+.003),dz)))
  add(v,[(0,1,5,4),(1,2,6,5),(2,3,7,6)],'scar')
 for j in range(14):
  z=1.0+j*.17;a=j*2.399;root=axis(z);reach=.75*(1-abs(z-2.0)/2.7)*rng.uniform(.8,1.14)
  end=root+Vector((math.cos(a)*reach,math.sin(a)*reach,.4));beam(root,end,.025*(1-z/5),'pale')
  for k in range(4):
   aa=a+(k-1.5)*.65;tip=end+Vector((math.cos(aa)*.32,math.sin(aa)*.32,rng.uniform(.14,.36)));beam(end,tip,.009,'twig',sides=5)
   for n in range(10):
    az=rng.random()*math.tau;rr=rng.random()**.5*.30
    c=tip+Vector((math.cos(az)*rr,math.sin(az)*rr,rng.uniform(-.14,.21)))
    leaf(c,rng.random()*math.tau,rng.uniform(.085,.15),'gold' if n%4==0 else col)
 for j in range(24):
  a=j*2.399;leaf(axis(3.4)+Vector((math.cos(a)*.24,math.sin(a)*.24,rng.uniform(0,.35))),a,.13,col)
 finalize(name)
birch('birch_amber',.20,'amber');birch('birch_russet',-.18,'russet')

def fractured(c,r,h,col,cap=None,style='granite',sides=11):
 # Each block is a sculpted convex fracture volume. Irregular oblique planes
 # replace the old radial ledge-stack topology. A small bevel catches grazing light.
 c=Vector(c);phase=rng.uniform(0,math.tau)
 count=9 if style=='granite' else sides
 angle=[phase+math.tau*(j+rng.uniform(-.09,.09))/count for j in range(count)]
 radius=[r*rng.uniform(.79,1.15) for j in range(count)]
 point=[]
 for row in range(4):
  for j,a in enumerate(angle):
   if row==0: z=-.04; scale=rng.uniform(.70,.94)
   elif row==1: z=h*rng.uniform(.12,.40);scale=rng.uniform(.99,1.13)
   elif row==2:z=h*rng.uniform(.58,.88);scale=rng.uniform(.82,1.05)
   else:z=h*(.82+.21*math.sin(a+.3)+rng.uniform(-.09,.11));scale=rng.uniform(.47,.85) if style=='granite' else rng.uniform(.77,.97)
   point.append(c+Vector((math.cos(a)*radius[j]*scale+h*.07*z/max(h,.1),math.sin(a)*radius[j]*scale,z)))
 bm=bmesh.new();[bm.verts.new(v) for v in point];bm.verts.ensure_lookup_table()
 hull=bmesh.ops.convex_hull(bm,input=list(bm.verts),use_existing_faces=False)
 dead=hull.get('geom_interior',[])+hull.get('geom_unused',[])
 if dead:bmesh.ops.delete(bm,geom=list(set(dead)),context='VERTS')
 bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
 # Narrow edge chips, never large rounded bevels.
 bmesh.ops.bevel(bm,geom=list(bm.edges),offset=min(r*.025,.018),segments=1,affect='EDGES')
 bm.verts.ensure_lookup_table();bm.verts.index_update();bm.faces.ensure_lookup_table()
 for face in bm.faces:
  vs=[v.co.copy() for v in face.verts];center=sum(vs,Vector())/len(vs)
  shade=col
  if cap and face.normal.z>.54 and center.z>c.z+h*.58 and (center.x-c.x)*.7+center.y-c.y<r*.40:shade=cap
  elif style=='ice' and face.normal.z<.15:shade='blueice' if face.normal.y<-.25 else col
  elif face.normal.z<-.1:shade='rockdark'
  add(vs,[tuple(range(len(vs)))],shade,.055)
 bm.free()
 # Discontinuous mineral fracture traces cross broad faces, following the real
 # oblique edge rather than forming horizontal decorative bands.

for name in ['granite_1','granite_2','granite_dry_1','granite_dry_2']:
 rng.seed(801 if name.endswith('1') else 806)
 fractured((-.23,0,0),1,.84,'rock','lichen' if 'dry' in name else 'snow')
 for j in range(5):
  a=j*2.399;fractured((math.cos(a)*.90-.15,math.sin(a)*.61,0),rng.uniform(.15,.29),rng.uniform(.14,.28),'rock',None,sides=7)
 finalize(name)
for name,style,col in [('basalt_scree','basalt','basalt'),('glacial_scree','ice','ice')]:
 fractured((-.15,0,0),.86,.72,col,'snow' if style=='ice' else None,style,9)
 for j in range(5):
  a=j*2.399;fractured((math.cos(a)*.68,math.sin(a)*.51,0),rng.uniform(.15,.26),rng.uniform(.17,.3),col,'snow' if style=='ice' and j%2 else None,style,7)
 finalize(name)
for name,style,col in [('basalt_columns','basalt','basalt'),('glacial_spires','ice','ice')]:
 # A low contiguous bedrock foot joins the intersecting pillars into a single outcrop.
 fractured((0,0,0),1.02,.33,col,None,'granite',13)
 for j,(x,y,r,h) in enumerate([(-.62,.13,.35,1.39),(-.13,.32,.39,2.18),(.42,.31,.36,1.8),(.73,-.15,.28,1.04),(-.38,-.37,.36,1.13),(.23,-.32,.35,1.51),(-.79,-.29,.22,.66),(.02,-.70,.22,.72)]):
  fractured((x,y,0),r,h,col,'snow' if style=='ice' else 'rock',style,7 if style=='ice' else 6)
 for j in range(7):
  a=j*2.4;fractured((math.cos(a)*.93,math.sin(a)*.74,0),rng.uniform(.12,.24),rng.uniform(.12,.30),col,None,style,6)
 finalize(name)
for name in ['juniper','juniper_dry']:
 for j in range(22):
  a=j*2.399;r=rng.uniform(.30,.74);end=Vector((math.cos(a)*r,math.sin(a)*r,rng.uniform(.14,.44)));beam((0,0,.02),end,.016,'twig',sides=5)
  for k in range(4):spray(end*(.30 if j%3==0 else .65)+Vector((0,0,.10)),a+(k-1.5)*.48,.29,.075,'needle2' if k%2 else 'needle',name=='juniper' and j%9==0 and k==1)
 finalize(name)
for j in range(42):
 a=j*2.399;r=rng.uniform(.03,.31);h=rng.uniform(.34,.96);root=Vector((math.cos(a)*r,math.sin(a)*r,0));d=Vector((math.cos(a),math.sin(a),0));s=Vector((-d.y,d.x,0));v=[]
 for k in range(5):
  t=k/4;c=root+d*(.33*t*t)+Vector((0,0,h*(t-.15*t*t)));w=.019*math.sin(math.pi*(t*.92+.035));v.extend([c-s*w,c+Vector((0,0,.006)),c+s*w])
 add(v,[(k*3,k*3+3,k*3+4,k*3+1) for k in range(4)]+[(k*3+1,k*3+4,k*3+5,k*3+2) for k in range(4)],'reeds')
 # Back faces remain explicit: the standard mesh material needs no alpha or double-side.
 add(v,[(k*3+1,k*3+4,k*3+3,k*3) for k in range(4)]+[(k*3+2,k*3+5,k*3+4,k*3+1) for k in range(4)],'reeds')
 if j%5==0:
  end=root+d*.08+Vector((0,0,h+.12));beam(root,end,.008,'reeds',sides=5);beam(end-Vector((0,0,.16)),end,.027,'rust',sides=7)
finalize('fen_reeds')

# Preserve the established prop design and authored metre dimensions, add real surface construction.
for name in ['field_fence','field_stores','bridge_span']:
 before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=str(SRC/(name+'.glb')))
 imported=set(bpy.data.objects)-before
 for ob in imported:
  if ob.type!='MESH':continue
  attr=ob.data.color_attributes.get('Col') or ob.data.color_attributes.active_color
  for face in ob.data.polygons:
   pts=[ob.matrix_world@ob.data.vertices[i].co for i in face.vertices]
   color=tuple(attr.data[face.loop_start].color[:3]) if attr else PAL['steel']
   add(pts,[tuple(range(len(pts)))],color,0)
 for ob in imported:bpy.data.objects.remove(ob,do_unlink=True)
 if name=='field_fence':
  for x in [-1.6,0,1.6]:
   for z in [.45,.94]:beam((x,-.105,z),(x,-.123,z),.017,'steel',r2=.017,sides=7)
  for z in [.435,.465,.925,.96]:box((0,-.102,z),(3.3,.003,.004),'joint')
 if name=='field_stores':
  for x,y,z in [(-.55,0,.3),(.45,.1,.3),(-.45,.1,.9)]:
   for off in [-.22,0,.22]:box((x+off,y,z+.286),(.009,.66,.004),'joint')
   for xx in [-.27,.27]:
    for zz in [-.20,.20]:beam((x+xx,y-.378,z+zz),(x+xx,y-.387,z+zz),.012,'steel',r2=.012,sides=6)
  for x,y in [(1.1,.05),(1.15,.66)]:beam((x+.09,y,.83),(x+.09,y,.867),.041,'steel',r2=.041,sides=10)
 if name=='bridge_span':
  for x in [-4.88,4.88]:
   for y in [-7.7,-5.33,-2.66,0,2.66,5.33,7.7]:
    box((x,y,.631),(.31,.38,.035),'steel')
    for dx in [-.09,.09]:
     for dy in [-.12,.12]:beam((x+dx,y+dy,.649),(x+dx,y+dy,.67),.026,'steel',r2=.026,sides=6)
  for y in [-6,-3,0,3,6]:box((0,y,.610),(9.5,.020,.013),'joint')
  for x in [-4.93,4.93]:box((x,0,.647),(.07,15.9,.045),'rust')
 finalize(name,fit=False)

# Export the origin-centred source collection before building a separate display scene.
stats={}
for ob in assets:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
 me=ob.data;me.calc_loop_triangles();vv=[v.co for v in me.vertices]
 stats[ob['asset_name']]={'triangles':len(me.loop_triangles),'vertices':len(me.vertices),'bounds_blender_xyz':{'min':[round(min(v[a] for v in vv),4) for a in range(3)],'max':[round(max(v[a] for v in vv),4) for a in range(3)]},'mesh_count':1,'material_count':1,'uv':'UVMap','colors':'Col'}
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ob['asset_name']+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_materials='EXPORT')
# Explicitly authored distance crowns preserve foliage area; simply decimating
# hundreds of disconnected sprays sheds the canopy, so LOD gets a different mesh.
lods=[]
near_assets=list(assets)
for source in near_assets:
 name=source['asset_name']
 if not name.startswith(('spruce','birch')):continue
 rng.seed(394+len(name))
 if name.startswith('spruce'):
  height=ORIGINAL[name]['max'][2];lean=.44 if 'windswept' in name else -.08 if 'young' in name else .16
  full=.85 if 'young' in name else 1.35 if 'windswept' in name else 1.25
  def ax(z):return Vector((lean*(z/height)**1.7,0,z))
  for j in range(8):beam(ax(j*height/8),ax((j+1)*height/8),.09*(1-j/9)+.006,'bark',sides=6)
  for level in range(8):
   z=.38+level*(height-.56)/8;reach=full*(1-z/height)**.78
   for j in range(5):
    angle=j*math.tau/5+level*2.399;d=Vector((math.cos(angle),math.sin(angle),-.10));side=Vector((-d.y,d.x,0));c=ax(z)+d*reach*.16
    shape=[(0,0),(.21,-.19),(.35,-.37),(.55,-.25),(.75,-.30),(1,0),(.75,.30),(.55,.25),(.35,.37),(.21,.19)]
    vv=[c+d*reach*t+side*reach*w for t,w in shape];vv.extend([c+d*reach*.44+Vector((0,0,reach*.13)),c+d*reach*.44-Vector((0,0,reach*.04))])
    add(vv,[(10,k,(k+1)%10) for k in range(10)]+[(11,(k+1)%10,k) for k in range(10)],'needle2' if j%3==0 else 'needle')
    if name!='spruce_dry' and (j+level)%3==0:
     cap=[vv[10]+Vector((0,0,.008))]+[vv[10].lerp(vv[k],.65)+Vector((0,0,.008)) for k in [1,3,4,6,7,9]]
     add(cap,[(0,k+1,(k+1)%6+1) for k in range(6)],'snow')
  # Six crown sprigs complete the taper with little vertex cost.
  for j in range(6):leaf(ax(height-.14+j*.021),j*2.399,.11,'needle')
 else:
  lean=.20 if 'amber' in name else -.18
  def ax(z):return Vector((lean*(z/3.8)**1.5,0,z))
  for j in range(7):beam(ax(j*3.7/7),ax((j+1)*3.7/7),.10*(1-j/8),'pale',sides=5)
  col='amber' if 'amber' in name else 'russet'
  for j in range(14):
   z=1+j*.17;angle=j*2.399;reach=.75*(1-abs(z-2)/2.7);end=ax(z)+Vector((math.cos(angle)*reach,math.sin(angle)*reach,.40));beam(ax(z),end,.025,'pale',sides=4)
   for k in range(8):
    a=k*2.399;rr=.31 if k%2 else .47
    leaf(end+Vector((math.cos(a)*rr,math.sin(a)*rr,.15+(k%3)*.10)),a,.27,'gold' if k%4==0 else col)
  for j in range(6):leaf(ax(3.50)+Vector((math.cos(j)*.23,math.sin(j)*.23,j*.032)),j,.23,col)
 lodname=name+'_lod'
 ORIGINAL[lodname]=ORIGINAL[name]
 ob=finalize(lodname)
 # Explicit LOD crowns are already within budget; do not decimate them again.
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob
 ob.data.calc_loop_triangles();vv=[v.co for v in ob.data.vertices]
 stats[lodname]={'triangles':len(ob.data.loop_triangles),'vertices':len(ob.data.vertices),'bounds_blender_xyz':{'min':[round(min(v[a] for v in vv),4) for a in range(3)],'max':[round(max(v[a] for v in vv),4) for a in range(3)]},'mesh_count':1,'material_count':1,'uv':'UVMap','colors':'Col','lod_of':name}
 bpy.ops.export_scene.gltf(filepath=str(OUT/(lodname+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
 ob.hide_render=True;ob.hide_set(True);lods.append(ob)
assets=near_assets
(P/'asset_stats.json').write_text(json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(P/'noordheim_environment.blend'))

# Contact sheet: normalized display scale, with real geometry and self shadows.
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True
scene.render.resolution_x=1800;scene.render.resolution_y=1520;scene.render.resolution_percentage=100
scene.world.color=(.32,.32,.32);scene.view_settings.view_transform='AgX'
world=scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.42,.48,1);world.node_tree.nodes['Background'].inputs[1].default_value=.45
for idx,ob in enumerate(assets):
 dim=max(ob.dimensions);scale=2.5/dim if dim else 1;ob.scale=(scale,)*3
 # Each model is first rotated about local up so the contact sheet isn't camera dependent.
 ob.location=((idx%5-2)*3.9,(idx//5-1.5)*4.4,.04-min(v.co.z for v in ob.data.vertices)*scale)
 bpy.ops.object.text_add(location=(ob.location.x-1.5,ob.location.y-1.70,.018))
 tx=bpy.context.object;tx.data.body=ob['asset_name'];tx.data.size=.215;tx.data.extrude=0;tx.rotation_euler=(0,0,0)
 txtmat=bpy.data.materials.get('Contact ink') or bpy.data.materials.new('Contact ink');txtmat.diffuse_color=(.7,.76,.75,1);tx.data.materials.append(txtmat)
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.location.z=-.02
m=bpy.data.materials.new('Contact charcoal');m.diffuse_color=(.037,.048,.049,1);ground.data.materials.append(m)
for loc,power,size in [((-8,-7,18),2400,10),((10,8,13),1700,8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=power;light.data.shape='DISK';light.data.size=size;light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-19,30));cam=bpy.context.object;cam.rotation_euler=(Vector((0,.2,0))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=22.4;scene.camera=cam
scene.render.filepath=str(P/'contact_sheet.png');bpy.ops.wm.save_as_mainfile(filepath=str(P/'contact_sheet.blend'));bpy.ops.render.render(write_still=True)
print('ENVIRONMENT COMPLETE',str(P))
