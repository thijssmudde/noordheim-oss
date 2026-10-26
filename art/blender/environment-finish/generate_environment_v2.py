"""Structural shelf-bank revision. Run Blender -b --python generate_environment_v2.py.
Uses the v1 common authoring helpers; does not read or modify the game checkout.
"""
from pathlib import Path
BASE=Path(__file__).resolve().parent
exec((BASE/'generate_environment.py').read_text().split("for args in [('spruce_coastal'")[0])
OUT=BASE/'glb-v2';OUT.mkdir(exist_ok=True)
rng.seed(72014)

def clip(poly,a,b,c):
 result=[]
 for j,p in enumerate(poly):
  q=poly[(j+1)%len(poly)];fp=a*p[0]+b*p[1]-c;fq=a*q[0]+b*q[1]-c
  if fp<=1e-8:result.append(p)
  if (fp<0)!=(fq<0):
   t=fp/(fp-fq);result.append((p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t))
 return result

def cells(outline,seeds):
 results=[]
 for i,s in enumerate(seeds):
  poly=outline[:]
  for j,t in enumerate(seeds):
   if i==j:continue
   poly=clip(poly,2*(t[0]-s[0]),2*(t[1]-s[1]),t[0]*t[0]+t[1]*t[1]-s[0]*s[0]-s[1]*s[1])
   if not poly:break
  results.append(poly)
 return results

def slab(poly,h,slope,col,cap,base=.05,gap=.016):
 # Inset fault lips make a narrow dark fissure while the cliff is continuous below.
 center=Vector((sum(v[0] for v in poly)/len(poly),sum(v[1] for v in poly)/len(poly),0))
 inset=[]
 for x,y in poly:
  v=Vector((x,y,0));d=center-v;v+=d.normalized()*gap;inset.append(v)
 n=len(poly)
 def top(v):return h+slope[0]*(v.x-center.x)+slope[1]*(v.y-center.y)+.012*math.sin(v.x*13+v.y*9)
 # Flat broken cap, with chamfered fractured edges and geometric fine relief.
 capring=[]
 for p in inset:
  q=p+(center-p).normalized()*.018;q.z=top(q);capring.append(q)
 for j,p in enumerate(inset):
  q=inset[(j+1)%n];upperp=capring[j];upperq=capring[(j+1)%n]
  add([Vector((p.x,p.y,top(p)-.035)),Vector((q.x,q.y,top(q)-.035)),upperq,upperp],[(0,1,2,3)],cap,.025)
  # Each sheer face has two oblique creases with varying offsets. Nothing forms
  # an enclosing horizontal decoration ring around the complete cliff.
  segments=4;levels=6;vv=[]
  for row in range(levels):
   t=row/(levels-1)
   for k in range(segments+1):
    along=k/segments;v=p.lerp(q,along);up=top(v)-.035
    v.z=base+(up-base)*t
    normal=Vector((q.y-p.y,p.x-q.x,0)).normalized()
    dis=.005*math.sin(along*10+t*13+j)+(.012 if row%3==1 else -.008)*math.sin(math.pi*along)
    v+=normal*dis
    vv.append(v)
  for row in range(levels-1):
   for k in range(segments):
    a=row*(segments+1)+k;f=(a,a+1,a+segments+2,a+segments+1)
    add([vv[z] for z in f],[(0,1,2,3)],col,.035)
 # Concentric triangulation stays on the same nearly level plane; no central peak.
 rings=[]
 for factor in [1,.70,.35]:
  ring=[]
  for p in capring:
   v=center.lerp(p,factor);v.z=top(v);ring.append(v)
  rings.append(ring)
 for row in range(2):
  for j in range(n):
   k=(j+1)%n;add([rings[row][j],rings[row][k],rings[row+1][k],rings[row+1][j]],[(0,1,2,3)],cap,.025)
 mid=center.copy();mid.z=top(mid)
 for j in range(n):add([rings[-1][j],rings[-1][(j+1)%n],mid],[(0,1,2)],cap,.025)
 add([Vector((p.x,p.y,base)) for p in inset],[tuple(reversed(range(n)))],col,.02)
 # Black fault floor is inset 2–3 cm below the lips, giving actual geometric depth.
 for j in range(n):
  p=Vector((*poly[j],0));q=Vector((*poly[(j+1)%n],0));ip=inset[j];iq=inset[(j+1)%n]
  p.z=base+.08;q.z=base+.08
  a=ip.copy();b=iq.copy();a.z=base+.08;b.z=base+.08
  add([p,q,b,a],[(0,1,2,3)],'blueice' if col=='ice' else 'rockdark',.02)

def shelf(name,kind,scree=False):
 # Outline is asymmetrical and grounded; its front apron feathers into terrain.
 outline=[(-1.07,-.55),(-.73,-.77),(-.05,-.81),(.63,-.70),(1.06,-.41),(1.10,.19),(.76,.64),(.21,.77),(-.48,.72),(-1.02,.37)]
 col='ice' if kind=='ice' else 'basalt';cap='snow' if kind=='ice' else 'rock'
 # One connected bedrock foot, so the upper fault network never floats separately.
 slab(outline,.17 if scree else .27,(.05,.06),col,col,base=-.04,gap=0)
 # A few large close-fitting slabs, not a cluster of upright pointed crystals.
 seeds=[(-.66,.37),(.01,.44),(.64,.33),(-.71,-.15),(-.15,-.17),(.43,-.17),(.77,-.47)]
 heights=[1.90,2.05,1.79,1.13,1.47,1.29,.55]
 if kind=='basalt':heights=[1.74,1.91,1.80,1.23,1.49,1.39,.66]
 if scree:heights=[.45,.63,.52,.28,.43,.34,.19]
 for i,poly in enumerate(cells(outline,seeds)):
  # Shared surfaces differ modestly within each stratum; fractures are cm-wide.
  slab(poly,heights[i],(rng.uniform(-.05,.05),rng.uniform(-.07,.05)),col,cap,base=.06,gap=.014 if not scree else .011)
 # Low oblique talus plates nest into the leading edge and remain mostly buried.
 for i,(x,y) in enumerate([(-.88,-.66),(-.36,-.80),(.29,-.78),(.83,-.56)]):
  rr=.23 if not scree else .18
  poly=[(x-rr,y-.10),(x+rr*.4,y-.13),(x+rr,y+.06),(x+rr*.18,y+.20),(x-rr*.8,y+.12)]
  slab(poly,.13 if scree else .22,(.04,.1),col,cap if kind=='ice' and i%2 else col,base=-.04,gap=0)
 finalize(name)

shelf('glacial_spires','ice');shelf('glacial_scree','ice',True)
shelf('basalt_columns','basalt');shelf('basalt_scree','basalt',True)

# LOD spruce uses forked branchlets rather than broad continuous tier fans.
# Every component remains closed/opaque; no billboard or alpha texture needed.
def narrow_spray(c,a,length,width,col,snow):
 c=Vector(c);d=Vector((math.cos(a),math.sin(a),-.14));s=Vector((-d.y,d.x,0))
 # A six-sided narrow bough, with pinched shoulder and upturned tip.
 edge=[c,c+d*length*.24-s*width*.65,c+d*length*.56-s*width,c+d*length+Vector((0,0,.025)),c+d*length*.56+s*width,c+d*length*.24+s*width*.65]
 ridge=c+d*length*.45+Vector((0,0,width*.22));bottom=ridge-Vector((0,0,width*.3))
 add(edge+[ridge,bottom],[(6,j,(j+1)%6) for j in range(6)]+[(7,(j+1)%6,j) for j in range(6)],col,.035)
 if snow:
  add([ridge+Vector((0,0,.008)),ridge.lerp(edge[1],.60)+Vector((0,0,.008)),ridge.lerp(edge[2],.60)+Vector((0,0,.008)),ridge.lerp(edge[3],.5)+Vector((0,0,.008))],[(0,1,2),(0,2,3)],'snow',.02)
for name in ['spruce_coastal','spruce_windswept','spruce_young','spruce_dry']:
 height=ORIGINAL[name]['max'][2];lean=.44 if 'windswept' in name else -.08 if 'young' in name else .16;full=.85 if 'young' in name else 1.35 if 'windswept' in name else 1.25
 def ax(z):return Vector((lean*(z/height)**1.7,0,z))
 for j in range(8):beam(ax(j*height/8),ax((j+1)*height/8),.09*(1-j/9)+.006,'bark',sides=6)
 for level in range(8):
  z=.38+level*(height-.56)/8;reach=full*(1-z/height)**.78
  for j in range(5):
   angle=j*math.tau/5+level*2.399;d=Vector((math.cos(angle),math.sin(angle),-.10));c=ax(z)+d*reach*.19
   for side in [-1,1]:
    narrow_spray(c+d*reach*.20,angle+side*.41,reach*.81,reach*.10,'needle2' if j%3==0 else 'needle',name!='spruce_dry' and (j+level)%4==0)
 for level in range(4):
  z=.62+level*.36;reach=full*(1-z/height)**.78
  for j in range(3):
   a=j*2.094+level*1.19;d=Vector((math.cos(a),math.sin(a),0))
   narrow_spray(ax(z)+d*reach*.40,a+.24,reach*.37,reach*.075,'needle',False)
 for j in range(6):leaf(ax(height-.14+j*.021),j*2.399,.11,'needle')
 lod=name+'_lod';ORIGINAL[lod]=ORIGINAL[name];finalize(lod)

stats={}
for ob in assets:
 bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;ob.data.calc_loop_triangles();v=[x.co for x in ob.data.vertices]
 stats[ob['asset_name']]={'triangles':len(ob.data.loop_triangles),'bounds':{'min':[round(min(p[a] for p in v),4) for a in range(3)],'max':[round(max(p[a] for p in v),4) for a in range(3)]}}
 bpy.ops.export_scene.gltf(filepath=str(OUT/(ob['asset_name']+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
(BASE/'asset_stats_v2.json').write_text(json.dumps(stats,indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'noordheim_environment_v2.blend'))

# Contact presentation: side faces and cap plateaus are both visible.
sc=bpy.context.scene;sc.render.engine='CYCLES';sc.cycles.samples=32;sc.cycles.use_denoising=True
sc.render.resolution_x=1600;sc.render.resolution_y=1100;sc.render.resolution_percentage=100;sc.view_settings.view_transform='AgX'
sc.world.use_nodes=True;sc.world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.42,.48,1);sc.world.node_tree.nodes['Background'].inputs[1].default_value=.6
for idx,ob in enumerate(assets):
 scale=2.8/max(ob.dimensions);ob.scale=(scale,)*3;ob.location=((idx%4-1.5)*4.2,(idx//4)*6.4,.04)
 bpy.ops.object.text_add(location=(ob.location.x-1.45,ob.location.y-1.6,.015));t=bpy.context.object;t.data.body=ob['asset_name'];t.data.size=.22
 m=bpy.data.materials.get('label') or bpy.data.materials.new('label');m.diffuse_color=(.7,.76,.75,1);t.data.materials.append(m)
bpy.ops.mesh.primitive_plane_add(size=200);g=bpy.context.object;g.location.z=-.015;m=bpy.data.materials.new('ground');m.diffuse_color=(.04,.05,.05,1);g.data.materials.append(m)
for loc,power,size in [((-6,-7,14),2200,9),((9,8,12),1700,8)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,1,0))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-16,19));cam=bpy.context.object;cam.rotation_euler=(Vector((0,3.2,.6))-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=19.2;sc.camera=cam
sc.render.filepath=str(BASE/'contact_sheet_v2.png');bpy.ops.wm.save_as_mainfile(filepath=str(BASE/'contact_sheet_v2.blend'));bpy.ops.render.render(write_still=True)
