"""Non-destructive Noordheim equipment finish pass, Blender 4.5.
Reads latest authored source trees. Exports only into --output, never saves inputs.
Usage: blender -b --python refine_equipment.py -- --source /path/noordheim --output /path/output
Original pivots, transforms, culture paint and detailed authored geometry survive.
Vertex colors contain restrained contact occlusion and broad surface weathering.
No textures or external assets; material UV/detail is supplied by the game renderer.
"""
import bpy, math, json, argparse, sys, struct
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.noise import noise_vector
p=argparse.ArgumentParser();p.add_argument('--source',required=True);p.add_argument('--output',required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);SRC=Path(a.source);OUT=Path(a.output);(OUT/'models').mkdir(parents=True,exist_ok=True);(OUT/'portraits').mkdir(exist_ok=True);(OUT/'previews').mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
SOURCES={
 'tactical.blend': ['ranger','rocket','tank','turret','howitzer','jotun','drone','gunship','reactor','airfield','lab','outpost','battery'],
 'landing-equipment.blend':['hq','lynx'],
 'architecture.blend':['barracks','factory','refinery'],
 'harvester.blend':['harvester'],
 'factions.blend':['camp','armory','depot','watchtower','raider','sapper','militia','marksman','snowmobile','mortar','bulwark','fenrir']}
def restore_pivot_names(dest,baseline):
    # Blender requires globally unique datablock names; GLB names are asset-local.
    data=dest.read_bytes();size=struct.unpack_from('<I',data,12)[0];doc=json.loads(data[20:20+size]);binary=data[28+size:]
    src=baseline.read_bytes();n=struct.unpack_from('<I',src,12)[0];original=json.loads(src[20:20+n])
    prefixes=('leg_left','leg_right','rotor_pivot','cargo_fill','tail_rotor_mount')
    for prefix in prefixes:
        desired=[n for n in original['nodes'] if n.get('name','').startswith(prefix)]
        actual=[n for n in doc['nodes'] if n.get('name','').startswith(prefix)]
        assert len(desired)==len(actual),(dest,prefix)
        for node,old in zip(actual,desired):node['name']=old['name']
    encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
    dest.write_bytes(struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(binary))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(binary),b'BIN\0')+binary)

roots=[]
for filename,names in SOURCES.items():
 before=set(bpy.data.objects)
 with bpy.data.libraries.load(str(SRC/'art'/filename),link=False) as (src,dst):dst.objects=list(src.objects)
 imported=set(bpy.data.objects)-before
 selected=[o for o in imported if o.name in names]
 assert len(selected)==len(names),(filename,[o.name for o in selected])
 keep={o for r in selected for o in [r,*r.children_recursive]}
 for o in imported:
  if o in keep:
   bpy.context.scene.collection.objects.link(o);o.hide_render=False;o.hide_set(False)
  else:bpy.data.objects.remove(o,do_unlink=True)
 roots.extend(selected)
# Canonical culture material: runtime relies on this exact name.
trim=bpy.data.materials.get('culture_trim')
for o in bpy.data.objects:
 if o.type=='MESH':
  for i,m in enumerate(o.data.materials):
   if m and m.name.startswith('culture_trim'):o.data.materials[i]=trim

# Material family responses: painted metal is a dielectric coating; cloth/wood
# retain broad diffuse highlights, exposed steel gets a restrained metallic sheen.
RESPONSE={'armor':(.69,.12),'snow':(.76,.02),'dark':(.73,.12),'rubber':(.93,0),'steel':(.43,.7),'glass':(.23,.15),'light':(.3,.05),'red':(.85,0),'wood':(.9,0),'concrete':(.92,0),'stone':(.94,0),'gold':(.48,.5),'skin':(.82,0),'orange':(.73,.02),'canvas':(.95,0),'leather':(.86,0),'rope':(.96,0),'tar':(.88,0),'turf':(.98,0),'ember':(.7,0),'harvester_ore':(.96,0),'culture_trim':(.7,.05)}
for m in bpy.data.materials:
 if not m.use_nodes:continue
 bs=m.node_tree.nodes.get('Principled BSDF')
 if not bs:continue
 family=m.name.split('.')[0].replace('_weathered','')
 rough,metal=RESPONSE.get(family,(.83,.02))
 bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 if family=='culture_trim':bs.inputs['Emission Strength'].default_value=0
 m['finish_family']=family

# Architecture's authored face colors are recovered into physically distinct
# response families, keeping one body mesh and its original coordinates.
ARCH={'red':'963f32','darkred':'70372f','wood':'95785c','stone':'92978b','cream':'d7d5bc','roof':'424f53','dark':'263738','glass':'799a9b','iron':'5d6965','gold':'baa05e','ore':'9a7043'}
def linear(c):return c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4
AC={k:Vector(tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))) for k,h in ARCH.items()}
ARCH_RESPONSE={'roof':(.52,.4),'iron':(.48,.62),'glass':(.24,.08),'gold':(.55,.35),'stone':(.92,0),'ore':(.95,0)}
for r in roots:
 if r.name not in ['barracks','factory','refinery']:continue
 for o in r.children_recursive:
  if o.type!='MESH' or not o.data.materials[0].name.startswith('Nordic'):continue
  attr=o.data.color_attributes.get('Col');o.data.materials.clear();slots={}
  for family in AC:
   m=bpy.data.materials.new('architecture_'+family);m.use_nodes=True;m.diffuse_color=(1,1,1,1)
   bs=m.node_tree.nodes.get('Principled BSDF');bs.inputs['Base Color'].default_value=(1,1,1,1)
   rough,metal=ARCH_RESPONSE.get(family,(.85,0));bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal;m['finish_family']=family
   slots[family]=len(o.data.materials);o.data.materials.append(m)
  for poly in o.data.polygons:
   c=Vector(attr.data[poly.loop_start].color[:3]);# Original colors carry .8-1 underside paint.
   family=min(AC,key=lambda k:min((c-AC[k]*f).length_squared for f in (.8,.85,.9,.95,1)))
   poly.material_index=slots[family]

# Keep existing machined bevels. Only the sparse sentry gets physical recoil
# channels and feed-box seams, placed inside its existing silhouette/bounds.
def box(root,name,loc,size,material):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.parent=root;o.scale=size
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(material)
 mod=o.modifiers.new('Small machined edge','BEVEL');mod.width=.015;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
r=next(r for r in roots if r.name=='turret');steel=bpy.data.materials.get('steel');dark=bpy.data.materials.get('dark')
parts=[]
for x in [-.48,.48]:
 parts.append(box(r,'Recoil channel',(x,-.39,2.19),(.22,1.02,.085),steel))
 parts.append(box(r,'Feed cover seam',(x,-.15,2.238),(.14,.47,.025),dark))
# Join new details by compatible material to avoid extra draw calls.
for m in [steel,dark]:
 obs=[o for o in r.children if o.type=='MESH' and o.data.materials[0]==m]
 if len(obs)>1:
  bpy.ops.object.select_all(action='DESELECT')
  for o in obs:o.select_set(True)
  bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join()

# Broad occlusion baked into vertices with deterministic cosine-distributed rays.
# This is not directional lighting, so normal game lights remain free to move.
RAYS=[]
for i in range(12):
 u=(i+.5)/12;phi=i*2.399963229728653
 RAYS.append(Vector((math.sqrt(u)*math.cos(phi),math.sqrt(u)*math.sin(phi),math.sqrt(1-u))))
report=[]
for root in sorted(roots,key=lambda r:r.name):
 objs=[o for o in root.children_recursive if o.type=='MESH']
 verts=[];faces=[]
 for o in objs:
  offset=len(verts);verts.extend(o.matrix_world@v.co for v in o.data.vertices)
  faces.extend(tuple(offset+i for i in poly.vertices) for poly in o.data.polygons)
 bvh=BVHTree.FromPolygons(verts,faces,all_triangles=False)
 zmax=max(v.z for v in verts);mins=[min(v[i] for v in verts) for i in range(3)];maxs=[max(v[i] for v in verts) for i in range(3)]
 rays_cache={}
 for o in objs:
  mesh=o.data;old=mesh.color_attributes.active_color
  if old:
   old_colors=[tuple(c.color) for c in old.data];old_domain=old.domain
  else:old_colors=None;old_domain=None
  # The byte layer keeps the tank below its existing 1.1MB asset budget.
  for attr in list(mesh.color_attributes):mesh.color_attributes.remove(attr)
  col=mesh.color_attributes.new(name='Surface',type='BYTE_COLOR',domain='POINT' if root.name=='tank' else 'CORNER');mesh.color_attributes.active_color=col
  nm=o.matrix_world.to_3x3().inverted().transposed()
  for poly in mesh.polygons:
   mat=mesh.materials[poly.material_index];family=mat.get('finish_family','armor');paint=mat==trim
   for li in poly.loop_indices:
    vi=mesh.loops[li].vertex_index;v=mesh.vertices[vi];p=o.matrix_world@v.co;n=(nm@(v.normal if root.name=='tank' else poly.normal)).normalized()
    key=tuple(round(x,4) for x in (*p,*n))
    if key not in rays_cache:
     tangent=n.cross(Vector((0,0,1)) if abs(n.z)<.9 else Vector((0,1,0))).normalized();bitangent=n.cross(tangent)
     hits=0
     for rv in RAYS:
      direction=tangent*rv.x+bitangent*rv.y+n*rv.z
      hit,normal,index,dist=bvh.ray_cast(p+n*.016,direction,.5 if zmax<3 else .8)
      if hit is not None:hits+=1-max(0,min(1,dist/(.5 if zmax<3 else .8)))*.45
     rays_cache[key]=1-.27*(hits/len(RAYS))
    ao=rays_cache[key]
    broad=noise_vector(p*2.6).x;streak=noise_vector(Vector((p.x*5,p.y*5,p.z*.4))).x
    oldcolor=old_colors[li if old_domain=='CORNER' else vi] if old_colors else (1,1,1,1)
    # Existing landing sources already have AO; avoid multiplying it twice.
    if root.name in ['hq','lynx']:ao=1-(1-ao)*.33
    variation=1 if paint else .965+broad*.035+streak*.022
    # Road dust and rain darkening settle at the base, not uniformly over the asset.
    dirt=max(0,1-p.z/(.65 if zmax<3 else .9))*(.09 if family in ['rubber','armor','snow','steel'] else .045)
    factor=ao*variation
    tint=(factor*(1+dirt*.12),factor*(1-dirt*.10),factor*(1-dirt*.32))
    if family in ['glass','light','ember']:tint=(1,1,1)
    col.data[vi if col.domain=='POINT' else li].color=tuple(max(0,min(1,oldcolor[c]*tint[c])) for c in range(3))+(1,)
  # Store constant base factor and a Blender preview multiplication explicitly.
  for mat in mesh.materials:
   bs=mat.node_tree.nodes.get('Principled BSDF')
   if not bs:continue
   if 'base_factor' not in mat:
    links=list(bs.inputs['Base Color'].links)
    if links and links[0].from_node.type=='MIX_RGB':factor=tuple(links[0].from_node.inputs[1].default_value)
    elif links and links[0].from_node.type=='VERTEX_COLOR':factor=(1,1,1,1)
    else:factor=tuple(bs.inputs['Base Color'].default_value)
    mat['base_factor']=factor
   for link in list(bs.inputs['Base Color'].links):mat.node_tree.links.remove(link)
   attr=mat.node_tree.nodes.get('Finish vertex color') or mat.node_tree.nodes.new('ShaderNodeVertexColor');attr.name='Finish vertex color';attr.layer_name='Surface'
   mix=mat.node_tree.nodes.get('Finish multiply') or mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.name='Finish multiply';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=mat['base_factor']
   mat.node_tree.links.new(attr.outputs['Color'],mix.inputs[2]);mat.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
 meshtris=sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)
 report.append({'asset':root.name,'source':next(k for k,v in SOURCES.items() if root.name in v),'triangles':meshtris,'source_meshes':len(objs),'blender_bounds':[mins,maxs],'gltf_bounds':[[mins[0],mins[2],-maxs[1]],[maxs[0],maxs[2],-mins[1]]],'preserved_pivots':[o.name for o in root.children_recursive if o.name.startswith(('leg_','rotor_pivot','cargo_fill','tail_rotor_mount'))]})
 print('REFINED',root.name,meshtris,flush=True)
# Save the editable material preview first; export uses constant factors to avoid
# Blender exporter ambiguities with multiply nodes and COLOR_0 attributes.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'equipment-finish.blend'))
for mat in bpy.data.materials:
 if 'base_factor' not in mat:continue
 bs=mat.node_tree.nodes.get('Principled BSDF')
 for link in list(bs.inputs['Base Color'].links):mat.node_tree.links.remove(link)
 bs.inputs['Base Color'].default_value=mat['base_factor']
for root in roots:
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for o in root.children_recursive:o.select_set(True)
 dest=OUT/'models'/(root.name+'.glb')
 bpy.ops.export_scene.gltf(filepath=str(dest),export_format='GLB',use_selection=True,export_yup=True,export_extras=True,export_vertex_color='NAME',export_vertex_color_name='Surface',export_all_vertex_colors=False,export_texcoords=False)
 restore_pivot_names(dest,SRC/'public/models/tactical'/(root.name+'.glb'))
 next(r for r in report if r['asset']==root.name)['bytes']=dest.stat().st_size
(OUT/'asset-budgets.json').write_text(json.dumps(report,indent=2))
# Portraits use the exact exported finish and provide a final review contact sheet.
for mat in bpy.data.materials:
 if 'base_factor' in mat:
  bs=mat.node_tree.nodes.get('Principled BSDF');mat.node_tree.links.new(mat.node_tree.nodes['Finish multiply'].outputs[0],bs.inputs['Base Color'])
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=20;scene.cycles.use_denoising=True
scene.render.resolution_x=384;scene.render.resolution_y=288;scene.render.resolution_percentage=100;scene.render.film_transparent=False
scene.render.image_settings.file_format='PNG';scene.world=bpy.data.worlds.new('Overcast field studio');scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.23,.29,.34,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.6
scene.view_settings.view_transform='AgX'
bpy.ops.object.camera_add();cam=bpy.context.object;cam.data.type='ORTHO';scene.camera=cam
for pos,energy,size,color in [((6,-8,12),1700,7,(1,.88,.72)),((-6,3,8),1300,6,(.65,.8,1))]:
 bpy.ops.object.light_add(type='AREA',location=pos);l=bpy.context.object;l.data.energy=energy;l.data.size=size;l.data.color=color;l.rotation_euler=(Vector((0,0,1))-l.location).to_track_quat('-Z','Y').to_euler()
for root in sorted(roots,key=lambda r:r.name):
 for other in roots:
  for o in other.children_recursive:o.hide_render=other!=root
 r=next(r for r in report if r['asset']==root.name);lo,hi=[Vector(x) for x in r['blender_bounds']];center=(lo+hi)/2
 cam.location=center+Vector((9,-12,9));cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler()
 cam.data.ortho_scale=max((hi-lo).x,(hi-lo).y,(hi-lo).z*1.4)*1.37
 scene.render.filepath=str(OUT/'previews'/(root.name+'.png'));bpy.ops.render.render(write_still=True)
 portrait=bpy.data.images.load(scene.render.filepath,check_existing=False);portrait.scale(256,192);portrait.filepath_raw=str(OUT/'portraits'/(root.name+'.png'));portrait.save();bpy.data.images.remove(portrait)
print('Equipment finish complete',flush=True)
