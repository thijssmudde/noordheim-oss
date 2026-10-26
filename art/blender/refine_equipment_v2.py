"""Structural second pass. Reads v1, writes separate models-v2 and equipment-v2.blend."""
import bpy,math,json,struct,bmesh,argparse,sys
from pathlib import Path
from mathutils import Vector
BASE=Path(__file__).resolve().parent
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=BASE.parent.parent)
parser.add_argument('--output',type=Path,default=BASE.parent/'generated-equipment')
parser.add_argument('--blend',type=Path,default=BASE.parent/'equipment-finish.blend')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
OUT=args.output;SRC=args.source;OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(args.blend))
KINDS=['ranger','rocket','raider','sapper','militia','marksman','tank','lynx','gunship']
roots=[bpy.data.objects[k] for k in KINDS];keep={o for r in roots for o in [r,*r.children_recursive]}
for o in list(bpy.data.objects):
 if o not in keep:bpy.data.objects.remove(o,do_unlink=True)
(OUT/'models-v2').mkdir(exist_ok=True);(OUT/'previews-v2').mkdir(exist_ok=True);(OUT/'portraits-v2').mkdir(exist_ok=True)
def mat(name,color,rough=.8,metal=0):
 m=bpy.data.materials.new(name);m.use_nodes=True;m['base_factor']=(*color,1);m.diffuse_color=(*color,1)
 bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=m.diffuse_color;bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 return m
cloth=mat('field_canvas',(.14,.18,.145),.92);web=mat('webbing',(.06,.075,.061),.94);mask=mat('balaclava',(.055,.065,.057),.93)
steel=bpy.data.materials['steel'];dark=bpy.data.materials['dark'];armor=bpy.data.materials['armor'];rubber=bpy.data.materials['rubber'];snow=bpy.data.materials['snow'];glass=bpy.data.materials['glass']
# Reuse neutral material families across appended source libraries.
for root in roots:
 for o in root.children_recursive:
  if o.type!='MESH':continue
  for i,m in enumerate(o.data.materials):
   family=m.name.split('.')[0].replace('_weathered','')
   canonical=bpy.data.materials.get(family)
   if canonical and 'base_factor' in canonical and 'base_factor' in m and max(abs(x-y) for x,y in zip(canonical['base_factor'],m['base_factor']))<.00001:o.data.materials[i]=canonical
newparts=[]
def finish(o,root,name,m):
 o.name=name;o.parent=root;o.data.materials.clear();o.data.materials.append(m)
 if not o.data.color_attributes:
  col=o.data.color_attributes.new(name='Surface',type='BYTE_COLOR',domain='POINT')
  for v,c in zip(o.data.vertices,col.data):
   f=.91+.05*math.sin(v.co.x*11+v.co.y*6+v.co.z*9);c.color=(f,f,f,1)
 newparts.append(o);return o

def box(root,name,pos,size,m,bevel=.007,rotation=(0,0,0)):
 bpy.ops.mesh.primitive_cube_add(size=1,location=pos);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.rotation_euler=rotation
 if bevel:
  mod=o.modifiers.new('Fitted edge','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,root,name,m)
def ellipsoid(root,name,pos,size,m):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=pos);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 for f in o.data.polygons:f.use_smooth=True
 return finish(o,root,name,m)
def beam(root,name,a,b,r,m,vertices=10):
 a,b=Vector(a),Vector(b);bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=(b-a).length,location=(a+b)/2);o=bpy.context.object;o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
 return finish(o,root,name,m)
def ring(root,name,pos,rx,ry,z,m,thickness=.018):
 verts=[];faces=[];n=24
 for zz,scale in [(z-thickness/2,1),(z+thickness/2,1),(z-thickness/2,.93),(z+thickness/2,.93)]:
  for i in range(n):
   a=i*2*math.pi/n;verts.append((pos[0]+rx*math.cos(a)*scale,pos[1]+ry*math.sin(a)*scale,zz))
 for i in range(n):
  j=(i+1)%n;faces.extend([(i,j,n+j,n+i),(n+i,n+j,3*n+j,3*n+i),(2*n+j,2*n+i,3*n+i,3*n+j)])
 d=bpy.data.meshes.new(name);d.from_pydata(verts,[],faces);d.update();o=bpy.data.objects.new(name,d);bpy.context.collection.objects.link(o);return finish(o,root,name,m)
def components(o):
 edges={v.index:set() for v in o.data.vertices}
 for e in o.data.edges:edges[e.vertices[0]].add(e.vertices[1]);edges[e.vertices[1]].add(e.vertices[0])
 rem=set(edges);out=[]
 while rem:
  found=set();todo=[next(iter(rem))]
  while todo:
   i=todo.pop()
   if i in found:continue
   found.add(i);todo.extend(edges[i]-found)
  rem-=found;vv=[o.matrix_world@o.data.vertices[i].co for i in found];lo=Vector(tuple(min(v[i] for v in vv) for i in range(3)));hi=Vector(tuple(max(v[i] for v in vv) for i in range(3)))
  out.append((found,(lo+hi)/2,hi-lo))
 return out
bounds={}
for root in roots:
 vv=[o.matrix_world@v.co for o in root.children_recursive if o.type=='MESH' for v in o.data.vertices]
 bounds[root.name]=[Vector(tuple(min(v[i] for v in vv) for i in range(3))),Vector(tuple(max(v[i] for v in vv) for i in range(3)))]

for root in roots[:6]:
 rocket=root.name=='rocket';kind=root.name
 for o in list(root.children_recursive):
  if o.type!='MESH':continue
  inverse=o.matrix_world.inverted()
  for ids,c,size in components(o):
   # Sculpt actual authored boot: lifted/rounded toe and narrower ankle instead
   # of a beveled brick. Original outsole remains on its gameplay ground plane.
   if o.name.startswith('Boot'):
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;front=max(0,min(1,(-p.y+.05)/.34));high=max(0,min(1,(p.z-.035)/.23))
     p.x=c.x+(p.x-c.x)*.83*(1-.22*high*(1-front*.7));p.z-=.095*front*high;p.y=c.y+(p.y-c.y)*.78+.025*front*high;o.data.vertices[i].co=inverse@p
   elif o.name.startswith('Trouser'):
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;t=max(0,min(1,(p.z-.25)/.68));p.x=c.x+(p.x-c.x)*(.69+.31*t);p.y=c.y+(p.y-c.y)*(.72+.28*t);o.data.vertices[i].co=inverse@p
   elif o.name.startswith('Knee pad'):
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;p.x=c.x+(p.x-c.x)*.80;p.z=c.z+(p.z-c.z)*.90;o.data.vertices[i].co=inverse@p
   elif abs(c.x)<.03 and abs(c.y)<.04 and 1.1<c.z<1.25 and size.x>.5:
    # Waist taper, rounded shoulders, keep the original coat/armor silhouette.
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;t=(p.z-(c.z-size.z/2))/size.z
     waist=.83+.17*math.sin(max(0,min(1,t))*math.pi/2);p.x=c.x+(p.x-c.x)*waist*.88;p.y=c.y+(p.y-c.y)*(.88+.12*t);o.data.vertices[i].co=inverse@p
   elif abs(c.x)>.2 and -.5<c.y<-.35 and 1.1<c.z<1.3 and len(ids)>70:
    # Existing forearms taper into actual grip positions, instead of floating.
    side=-1 if c.x<0 else 1;reach=.38 if kind in ['sapper','marksman'] else .36
    olda=Vector((side*(reach+.04),-.3,1.13));oldb=Vector((side*.15,-.55,1.27));newb=Vector((.30 if rocket else .08,-.24 if rocket else (-.48 if side>0 else -.78),1.50 if rocket else 1.27))
    axis=oldb-olda
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;t=max(0,min(1,(p-olda).dot(axis)/axis.length_squared));p+=(newb-oldb)*t;mid=olda+axis*t;p=mid+(p-mid)*(.94-.10*t) if not rocket else p;o.data.vertices[i].co=inverse@p
   elif o.data.materials[0].name.startswith('skin'):
    # Anatomical face/jaw taper, broad exposed cheek above the face-wrap.
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;t=max(0,min(1,(p.z-1.49)/.35));p.x*=.52+.25*t
     if p.z<1.72:p.y*=.78
     o.data.vertices[i].co=inverse@p
    for f in o.data.polygons:f.use_smooth=True
   # Helmet/hood upper shell gets smooth shading, eliminating faceted head bands.
   if c.z>1.84 and abs(c.x)<.03 and size.x>.38:
    for i in ids:
     p=o.matrix_world@o.data.vertices[i].co;p.x*=.84;p.y=.02+(p.y-.02)*.88;o.data.vertices[i].co=inverse@p
    for f in o.data.polygons:
     if all(i in ids for i in f.vertices):f.use_smooth=True
  o.data.update()
 # Rebuild the existing cylindrical sleeve topology into a continuous tailored
 # shoulder/elbow/cuff surface. Existing source torso, equipment and palms remain.
 sleeve_materials={
  'ranger':(snow,armor),'rocket':(armor,armor),'raider':(snow,snow),
  'sapper':(armor,armor),'militia':(bpy.data.materials.get('leather'),bpy.data.materials.get('leather')),
  'marksman':(bpy.data.materials.get('turf'),bpy.data.materials.get('turf'))}
 for o in list(root.children_recursive):
  if o.type!='MESH':continue
  removal=set()
  for ids,c,size in components(o):
   if len(ids)==96 and abs(c.x)>.035 and -.71<c.y<.02 and 1.05<c.z<1.51 and size.z<.72 and size.x<.75:
    # Only sleeves were authored as six rings of sixteen cylinder vertices.
    if len(ids)==96:removal.update(ids)
  if removal:
   bm=bmesh.new();bm.from_mesh(o.data);bm.verts.ensure_lookup_table();bmesh.ops.delete(bm,geom=[bm.verts[i] for i in removal],context='VERTS');bm.to_mesh(o.data);bm.free();o.data.update()
 for side in [-1,1]:
  wrist=Vector((.30 if rocket else .08,-.24 if rocket else (-.45 if side>0 else -.77),1.50 if rocket else 1.255))
  shoulder=Vector((side*.315,.002,1.405));elbow=Vector((side*.397,-.285,1.165))
  centers=[shoulder,shoulder.lerp(elbow,.23),shoulder.lerp(elbow,.62),elbow,elbow.lerp(wrist,.37),elbow.lerp(wrist,.76),wrist]
  radii=[.125,.128,.111,.104,.088,.070,.063]
  verts=[];faces=[];N=12
  for i,c in enumerate(centers):
   tangent=(centers[min(i+1,len(centers)-1)]-centers[max(0,i-1)]).normalized();u=tangent.cross(Vector((0,1,0))).normalized();v=tangent.cross(u)
   for k in range(N):
    theta=k*math.tau/N;r=radii[i]*(1+.045*math.sin(k*2.4+i*1.7));verts.append(c+(u*math.cos(theta)+v*math.sin(theta)*.88)*r)
  for i in range(len(centers)-1):
   for k in range(N):faces.append((i*N+k,i*N+(k+1)%N,(i+1)*N+(k+1)%N,(i+1)*N+k))
  faces.extend([tuple(reversed(range(N))),tuple(range((len(centers)-1)*N,len(centers)*N))])
  d=bpy.data.meshes.new('Tailored articulated sleeve');d.from_pydata(verts,[],faces);d.update();ob=bpy.data.objects.new('Tailored articulated sleeve',d);bpy.context.collection.objects.link(ob);finish(ob,root,'Tailored articulated sleeve',sleeve_materials[kind][0]);ob.data.materials.append(sleeve_materials[kind][1])
  for f in ob.data.polygons:f.use_smooth=True;f.material_index=0
  ellipsoid(root,'Elbow fabric reinforcement',elbow+Vector((side*.03,.015,0)),(.102,.097,.090),sleeve_materials[kind][1])
 # Gaiters and boot sole welt attach to the existing articulated leg parents.
 for leg in [o for o in root.children if o.name.startswith('leg_')]:
  x=leg.location.x
  for name,pos,size in [('Boot sole',(x,-.06,.061),(.194,.345,.038)),('Ankle gaiter',(x,.015,.28),(.18,.19,.075)),('Shin reinforcement',(x,-.108,.39),(.145,.035,.21))]:
   ob=box(root,name,pos,size,dark,.008);world=ob.matrix_world.copy();ob.parent=leg;ob.matrix_world=world
 # Actual tactical headgear: rim, face-wrap, ear protection and neck shadow.
 if kind not in ['militia','marksman','raider']:
  ring(root,'Helmet lower rim',(0,.02),.202 if kind!='sapper' else .224,.211 if kind!='sapper' else .231,1.824,dark,.024)
  for side in [-1,1]:ellipsoid(root,'Helmet ear cup',(side*.17,.015,1.737),(.037,.076,.075),armor)
 ellipsoid(root,'Fabric face wrap',(0,-.107,1.651),(.129,.086,.089),mask)
 ellipsoid(root,'Neck gaiter',(0,.014,1.52),(.128,.12,.079),web)
 if kind in ['ranger','rocket','sapper']:
  box(root,'Helmet mount',(0,-.185,1.918),(.081,.047,.057),dark,.01)
 for side in [-1,1]:
  box(root,'Carrier shoulder strap',(side*.182,-.184,1.392),(.069,.084,.215),web,.012,rotation=(.28,0,0))
  box(root,'Carrier waist strap',(side*.232,-.168,1.065),(.061,.075,.37),cloth,.01,rotation=(0,0,side*.18))
 for x in [-.18,0,.18]:
  box(root,'Pouch lid',(x,-.388,1.17),(.122,.035,.047),cloth,.008)
  box(root,'Pouch retention',(x,-.409,1.094),(.027,.014,.10),web,.003)
 box(root,'Carrier lower belt',(0,-.206,.925),(.48,.065,.062),web,.012)
 box(root,'Belt buckle',(0,-.247,.932),(.066,.019,.045),steel,.005)
 # Hand palms are shaped geometry wrapped around gun furniture.
 if rocket:
  for pos in [(.3,-.24,1.48),(.25,-.51,1.59)]:ellipsoid(root,'Insulated glove',pos,(.075,.096,.065),web)
  beam(root,'Launcher shoulder pad',(.3,.30,1.66),(.3,.48,1.66),.115,cloth,12)
  beam(root,'Launcher front collar',(.3,-.72,1.66),(.3,-.79,1.66),.116,steel,12)
  box(root,'Launcher optic bracket',(.29,-.19,1.79),(.08,.15,.065),dark,.006)
 else:
  for pos in [(.12,-.455,1.235),(.08,-.77,1.252)]:ellipsoid(root,'Insulated glove',pos,(.068,.105,.061),web)
  # Receiver, charging handle, trigger grip and sight geometry fit the existing gun.
  box(root,'Pistol grip',(.08,-.40,1.201),(.077,.088,.155),dark,.009,rotation=(-.24,0,0))
  box(root,'Receiver side rail',(.151,-.555,1.316),(.023,.34,.040),steel,.003)
  box(root,'Receiver cover',(.08,-.52,1.389),(.101,.20,.022),steel,.003)
  box(root,'Ejection port',(.168,-.49,1.34),(.014,.088,.022),dark,.002)
  beam(root,'Charging handle',(.136,-.398,1.348),(.187,-.398,1.348),.014,steel,8)
  if kind in ['ranger','raider','sapper']:
   box(root,'Reflex sight housing',(.08,-.40,1.427),(.077,.095,.066),dark,.006)
   box(root,'Reflex sight lens',(.08,-.45,1.438),(.053,.014,.028),glass,.003)
  if kind=='ranger':
   beam(root,'Muzzle collar',(.08,-1.30,1.34),(.08,-1.377,1.34),.034,dark,12)
   for y in [-.72,-.79,-.86]:box(root,'Handguard rib',(.081,y,1.382),(.14,.015,.015),steel,.002)
 # A broad irregular field pattern makes fabric different from bare smooth plastic.
 for o in root.children_recursive:
  if o.type!='MESH':continue
  col=o.data.color_attributes.get('Surface')
  if not col:continue
  for poly in o.data.polygons:
   material=o.data.materials[poly.material_index]
   if not material.name.startswith(('snow','armor','canvas','leather','turf')):continue
   for li in poly.loop_indices:
    vi=o.data.loops[li].vertex_index;p=o.matrix_world@o.data.vertices[vi].co
    # Broad cloth camo islands, not high frequency grit.
    camo=math.sin(p.x*18+p.z*8)+.65*math.sin(p.y*29-p.z*12)
    f=.73 if camo>.62 else .93
    i=vi if col.domain=='POINT' else li;old=col.data[i].color;col.data[i].color=(old[0]*f,old[1]*f,old[2]*f,1)
 print('INFANTRY',kind,flush=True)

# Harden existing over-rounded armor corners without increasing geometry or bounds.
for root in roots[6:]:
 for o in list(root.children_recursive):
  if o.type!='MESH' or not o.data.materials[0].name.startswith(('armor','snow')):continue
  inv=o.matrix_world.inverted()
  for ids,c,size in components(o):
   if min(size)<.35 or max(size)<1.1:continue
   for i in ids:
    p=o.matrix_world@o.data.vertices[i].co
    for axis in range(3):
     u=(p[axis]-c[axis])/(size[axis]/2);p[axis]=c[axis]+math.copysign(abs(u)**.78,u)*size[axis]/2
    o.data.vertices[i].co=inv@p
  o.data.update()

r=bpy.data.objects['tank']
# Segmented turret applique armor, thermal barrel sleeve, mantlet reinforcement,
# crew hatch mechanisms and restrained stowage. Existing tank stays under 25k tris.
for side in [-1,1]:
 for y in [-.69,-.17,.35]:box(r,'Turret applique panel',(side*.934,y,2.012),(.026,.43,.36),armor,.004)
 for y in [-1.5,-.72,.07,.85,1.5]:
  box(r,'Skirt top hinge',(side*1.38,y,1.485),(.033,.22,.075),steel,.004)
 for y in [-1.05,-.4,.25]:box(r,'Hull weld joint',(side*.99,y,1.51),(.025,.5,.017),dark,.003)
 box(r,'Turret stowage rack',(side*.63,.79,2.036),(.34,.33,.35),dark,.01)
 box(r,'Stowed canvas roll',(side*.63,.805,2.05),(.28,.30,.27),cloth,.055)
 for z in [1.99,2.10]:box(r,'Rack webbing',(side*.63,.973,z),(.29,.018,.025),web,.003)
for y in [-2.05,-2.68,-3.30]:beam(r,'Barrel thermal sleeve',(0,y+.11,1.98),(0,y-.11,1.98),.107,armor,12)
beam(r,'Mantlet collar',(0,-1.41,1.98),(0,-1.54,1.98),.205,steel,16)
box(r,'Hatch handle',(-.35,.18,2.378),(.16,.045,.032),dark,.005)
for x in [-.54,-.20]:box(r,'Hatch hinge',(x,.25,2.34),(.06,.15,.04),steel,.003)
for x in [-.6,-.32,-.04,.24,.52]:box(r,'Rear deck cooling fin',(x,1.25,1.551),(.026,.56,.025),dark,.003)

r=bpy.data.objects['lynx']
# Cut tyre body back slightly and add true alternating shoulder/tread blocks.
for o in r.children_recursive:
 if o.type!='MESH' or not o.data.materials[0].name.startswith('rubber'):continue
 inv=o.matrix_world.inverted()
 for ids,c,size in components(o):
  if .85<size.y<1.05 and .85<size.z<1.05:
   for i in ids:
    p=o.matrix_world@o.data.vertices[i].co;p.y=c.y+(p.y-c.y)*.935;p.z=c.z+(p.z-c.z)*.935;o.data.vertices[i].co=inv@p
for side in [-1,1]:
 for cy in [-1.22,0,1.22]:
  for i in range(20):
   a=i*math.tau/20;y=cy+math.sin(a)*.47;z=.58+math.cos(a)*.47
   box(r,'Tyre tread',(side*1.05,y,z),(.42,.098,.04),rubber,0,rotation=(-a,0,0))
  # Rim fasteners and center indentation around the existing hubs.
  for i in range(6):
   a=i*math.tau/6;ellipsoid(r,'Wheel lug',(side*1.286,cy+math.sin(a)*.155,.58+math.cos(a)*.155),(.014,.024,.024),steel)
 for y in [-.49,.21]:
  box(r,'Door seam',(side*.934,y,1.525),(.017,.019,.60),dark,.002)
 box(r,'Door lower seam',(side*.934,-.14,1.228),(.017,.70,.020),dark,.002)
 box(r,'Hinged door panel',(side*.947,-.54,1.79),(.027,.077,.102),steel,.005)
 box(r,'Front armor fastener rail',(side*.817,-1.617,1.51),(.048,.026,.24),steel,.004)
 for y in [-1.65,1.58]:box(r,'Wheel arch reinforcing strip',(side*1.077,y,1.04),(.26,.12,.055),armor,.008)
 box(r,'Roof hatch rail',(side*.46,.16,2.063),(.04,.55,.035),dark,.003)
 for x in [-.41,.41]:box(r,'Cabin roof seam',(x,-.98,2.044),(.020,.63,.018),dark,.002)
box(r,'Windshield central pillar',(0,-1.624,1.839),(.056,.032,.384),armor,.006,rotation=(-.18,0,0))
box(r,'Upper front armor seam',(0,-1.677,1.59),(1.34,.019,.026),dark,.002)
beam(r,'Autocannon collar',(0,-.89,2.28),(0,-1.03,2.28),.072,steel,12)
box(r,'Weapon sensor housing',(.29,.10,2.374),(.14,.22,.068),dark,.01)
for y in [.59,.83,1.07]:box(r,'Tarpaulin crease',(0,y,2.449),(1.10,.014,.019),web,.003)

r=bpy.data.objects['gunship']
# Cockpit frames follow the authored glass, paired access panels, turbine louvers
# and rotor head mechanisms; no new external silhouette or rotor parenting change.
for side in [-1,1]:
 beam(r,'Cockpit frame',(side*.40,-2.29,2.03),(side*.48,-1.61,2.30),.026,armor,8)
 beam(r,'Canopy sill',(side*.42,-2.22,1.79),(side*.50,-1.44,1.83),.022,armor,8)
 for y in [-.69,.63]:
  box(r,'Access panel seam',(side*.652,y,1.89),(.012,.022,.60),dark,.002)
 box(r,'Access panel lower joint',(side*.652,-.03,1.598),(.012,1.3,.024),dark,.002)
 for y in [.13,.33,.53,.73]:box(r,'Turbine cooling louvre',(side*.556,y,2.57),(.018,.047,.22),dark,.002)
 box(r,'Wing hardpoint',(side*1.71,.13,1.88),(.23,.29,.063),steel,.008)
beam(r,'Canopy center frame',(0,-2.485,2.03),(0,-1.41,2.37),.021,armor,8)
for a in [0,math.pi/2,math.pi,math.pi*1.5]:
 beam(r,'Rotor swash linkage',(math.cos(a)*.13,math.sin(a)*.13,2.96),(math.cos(a)*.27,math.sin(a)*.27,3.10),.023,steel,8)
beam(r,'Chin cannon collar',(0,-2.14,1.3),(0,-2.25,1.3),.058,steel,12)

# Clamp only new geometry to the original total bounds; authored pivots/transforms
# remain untouched. Group added details per parent/material for bounded draw calls.
bpy.context.view_layer.update()
for root in roots:
 lo,hi=bounds[root.name]
 for o in root.children_recursive:
  if o.type!='MESH' or o not in newparts:continue
  inv=o.matrix_world.inverted()
  for v in o.data.vertices:
   p=o.matrix_world@v.co
   for axis in range(3):p[axis]=max(lo[axis],min(hi[axis],p[axis]))
   v.co=inv@p
 # Infantry anatomy retains the original total extents, with the shoulder
 # span correction distributed continuously through the authored surface.
 if root.name in KINDS[:6]:
  objs=[o for o in root.children_recursive if o.type=='MESH'];points=[o.matrix_world@v.co for o in objs for v in o.data.vertices]
  newlo=Vector(tuple(min(p[i] for p in points) for i in range(3)));newhi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
  for o in objs:
   inv=o.matrix_world.inverted()
   for vertex in o.data.vertices:
    p=o.matrix_world@vertex.co
    for axis in range(3):p[axis]=lo[axis]+(p[axis]-newlo[axis])*(hi[axis]-lo[axis])/(newhi[axis]-newlo[axis])
    vertex.co=inv@p
 # Group compatible static siblings, preserving leg/rotor trees.
 parents=[root,*[o for o in root.children_recursive if o.type=='EMPTY']]
 for parent in parents:
  groups={}
  for o in list(parent.children):
   if o.type=='MESH' and len(o.data.materials)==1:groups.setdefault(o.data.materials[0],[]).append(o)
  for m,parts in groups.items():
   if len(parts)<2:continue
   bpy.ops.object.select_all(action='DESELECT')
   for o in parts:o.select_set(True)
   bpy.context.view_layer.objects.active=parts[0];bpy.ops.object.join()
 # Clear inherited custom normals before smoothing human anatomy. The source
 # joined flat spheres to machined boxes, retaining faceted helmet normals.
 if root.name in KINDS[:6]:
  for o in root.children_recursive:
   if o.type!='MESH':continue
   bpy.context.view_layer.objects.active=o
   if o.data.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
   for face in o.data.polygons:face.use_smooth=True
   o.data.set_sharp_from_angle(angle=math.pi if o.name.startswith('Tailored articulated sleeve') else math.radians(38))
 # New UV-less meshes receive material × Surface preview shading.
 for o in root.children_recursive:
  if o.type!='MESH':continue
  for m in o.data.materials:
   if 'base_factor' not in m:continue
   bs=m.node_tree.nodes.get('Principled BSDF');nodes=m.node_tree.nodes
   attr=nodes.get('Finish vertex color') or nodes.new('ShaderNodeVertexColor');attr.name='Finish vertex color';attr.layer_name='Surface'
   mix=nodes.get('Finish multiply') or nodes.new('ShaderNodeMixRGB');mix.name='Finish multiply';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=m['base_factor']
   m.node_tree.links.new(attr.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'equipment-v2.blend'))
for m in bpy.data.materials:
 if 'base_factor' in m:
  bs=m.node_tree.nodes.get('Principled BSDF')
  for link in list(bs.inputs['Base Color'].links):m.node_tree.links.remove(link)
  bs.inputs['Base Color'].default_value=m['base_factor']
# Same asset-local runtime name normalization as v1.
helper=(BASE/'refine_equipment.py').read_text();exec(helper[helper.index('def restore_pivot_names'):helper.index('roots=[]')])
for root in roots:
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 dest=OUT/'models-v2'/(root.name+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_vertex_color='NAME',export_vertex_color_name='Surface',export_all_vertex_colors=False,export_texcoords=False)
 restore_pivot_names(dest,SRC/'public/models/tactical'/(root.name+'.glb'))
for m in bpy.data.materials:
 if 'base_factor' in m:
  bs=m.node_tree.nodes.get('Principled BSDF');m.node_tree.links.new(m.node_tree.nodes['Finish multiply'].outputs[0],bs.inputs['Base Color'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32;scene.cycles.use_denoising=True;scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=False
scene.world=bpy.data.worlds.new('Review studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.23,.29,.34,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6;scene.view_settings.view_transform='AgX'
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';scene.camera=cam
for pos,energy,size,color in [((6,-8,12),1700,7,(1,.88,.72)),((-6,3,8),1300,6,(.65,.8,1))]:
 bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=energy;l.data.size=size;l.data.color=color;l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
for root in roots:
 for other in roots:
  for o in other.children_recursive:o.hide_render=other!=root
 lo,hi=bounds[root.name];center=(lo+hi)/2;cam.location=center+Vector((9,-12,9));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.ortho_scale=max((hi-lo).x,(hi-lo).y,(hi-lo).z*1.4)*1.37
 scene.render.filepath=str(OUT/'previews-v2'/(root.name+'.png'));bpy.ops.render.render(write_still=True)
 image=bpy.data.images.load(scene.render.filepath,check_existing=False);image.scale(256,192);image.filepath_raw=str(OUT/'portraits-v2'/(root.name+'.png'));image.save();bpy.data.images.remove(image)
print('V2 complete',flush=True)
