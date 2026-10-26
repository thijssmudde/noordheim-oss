"""Biome extensions to Skerry's sculpted, opaque, vertex-colour landscape kit.

Read-only Skerry mesh reuse, broad authored faces, continuous caps, matched metres
and .9 roughness. Run headlessly: pnpm art:tactical biomes. Never opens the artist's UI.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/landscape'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
rng = random.Random(7103)
roots = []
material = bpy.data.materials.new('Skerry biome baked colour')
material.use_nodes = True
vertex = material.node_tree.nodes.new('ShaderNodeVertexColor')
vertex.layer_name = 'Col'
bsdf = material.node_tree.nodes.get('Principled BSDF')
material.node_tree.links.new(vertex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = .9

def rgb(value):
    channels = [int(value[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple(v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in channels)

def start(name, biome):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root['biome'] = biome
    root['ambient_only'] = True
    root['art_family'] = 'Skerry sculpted landscape'
    roots.append(root)
    return root

def finish(obj, shade, top=None, underside=None):
    obj.parent = roots[-1]
    obj.data.materials.clear()
    obj.data.materials.append(material)
    attr = obj.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    for face in obj.data.polygons:
        # Same restrained variation and underside shade as Skerry, with coherent face planes.
        base = rgb(top if top and face.normal.z > .55 else underside if underside and face.normal.z < -.15 else shade)
        light = rng.uniform(.96, 1.04) * (.78 + .22*max(0, face.normal.z))
        for index in face.loop_indices:
            attr.data[index].color = tuple(min(1, c*light) for c in base)+(1,)
    return obj

def mesh(name, vertices, faces, shade, top=None, underside=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, shade, top, underside)

def beam(name, a, b, radius, shade, sides=7):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius, radius2=radius*.62,
        depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = (b-a).to_track_quat('Z','Y').to_euler()
    return finish(obj, shade)

def ledge(name, center, radius, height, shade, top, sides=7, lean=.08):
    """The same three-ring fractured ledges used by Skerry granite, with a bevelled cap."""
    center = Vector(center)
    phase = rng.uniform(-.3,.3)
    ring = [radius*rng.uniform(.86,1.12) for _ in range(sides)]
    verts = []
    for size, z, dx in [(1,-.04,0),(1.04,height*.40,lean*.3),(.78,height,lean)]:
        for j in range(sides):
            a = j*math.tau/sides+phase
            verts.append(center+Vector((math.cos(a)*ring[j]*size+dx, math.sin(a)*ring[j]*size, z+(math.sin(a+.7)*height*.18 if name=='Fractured ice shelf' and size==.78 else 0))))
    faces = []
    for layer in range(2):
        for j in range(sides):
            k=(j+1)%sides
            faces.append((layer*sides+j,layer*sides+k,(layer+1)*sides+k,(layer+1)*sides+j))
    faces.extend([tuple(range(sides*2,sides*3)),tuple(reversed(range(sides)))])
    return mesh(name, verts, faces, shade, top, shade)

# Glacial faces are connected angular shelves, with snow on the faces themselves.
start('glacial_spires', 'frostgate')
for x,y,r,h in [(-.7,.15,.65,1.5),(.05,.25,.78,2.15),(.68,.18,.52,1.2)]:
    ledge('Fractured ice shelf',(x,y,0),r,h,'90b7be','dde5df',7,.17)
ledge('Dark exposed foot',(.1,-.48,0),.67,.42,'747e7b','bdcbc4',7)
start('glacial_scree', 'frostgate')
for x,y,r,h in [(-.48,0,.66,.7),(.38,.13,.54,.55),(.05,-.38,.32,.28)]:
    ledge('Snow-bound erratic',(x,y,0),r,h,'82908d','d9e1d8')

# Birch canopies use solid scalloped layers, comparable to Skerry's 800-triangle spruce.
def canopy(center, radius, depth, shade, highlight):
    center=Vector(center)
    sides=10
    phase=rng.random()*math.tau
    radii=[radius*rng.uniform(.85,1.12)*(1 if j%2 else .87) for j in range(sides)]
    verts=[center+Vector((.04,0,depth))]
    for size,z in [(.68,depth*.55),(1,0),(.58,-depth*.38)]:
        for j in range(sides):
            a=j*math.tau/sides+phase
            verts.append(center+Vector((math.cos(a)*radii[j]*size,math.sin(a)*radii[j]*size,z)))
    verts.append(center+Vector((0,0,-depth*.5)))
    faces=[]
    for j in range(sides):
        k=(j+1)%sides
        faces.extend([(0,1+j,1+k), (1+j,11+j,11+k,1+k), (11+j,21+j,21+k,11+k), (31,21+k,21+j)])
    mesh('Sculpted birch foliage',verts,faces,shade,highlight,'71613d')

for name,shade,highlight,lean in [('birch_amber','ac8d49','c3ab66',.20),('birch_russet','a67b48','c09a60',-.18)]:
    start(name,'amberfen')
    def axis(z):
        return Vector((lean*(z/3.7)**1.6, math.sin(z*1.2)*.035,z))
    for i in range(5):
        z=i*.72
        beam('Bent birch trunk',axis(z),axis(z+.72),.115*(1-i/6),'c0c1af',8)
    # Short bark scars are attached to the trunk, not separate rings around an unrelated axis.
    for i in range(8):
        z=.25+i*.34; c=axis(z); r=.105*(1-z/4.5)
        mesh('Birch bark scar',[c+Vector((-.045,-r,0)),c+Vector((.047,-r,.017)),
            c+Vector((.034,-r,.047)),c+Vector((-.04,-r,.035))],[(0,1,2,3)],'5c635a')
    for i in range(7):
        a=i*2.399; z=1.4+i*.24; reach=.68 if i<5 else .40
        end=axis(z)+Vector((math.cos(a)*reach,math.sin(a)*reach,.3))
        beam('Birch crown branch',axis(z-.3),end,.038,'868875',6)
        canopy(end,.68 if i<5 else .52,.35,shade,highlight)
    canopy(axis(3.35),.48,.44,shade,highlight)

# Broad, bent, tapered blades with compact seedheads, rather than tubular rods.
start('fen_reeds','amberfen')
for i in range(14):
    a=i*2.399; r=rng.uniform(.03,.27); h=rng.uniform(.6,1.05)
    root=Vector((math.cos(a)*r,math.sin(a)*r,0))
    along=Vector((math.cos(a),math.sin(a),0)); side=Vector((-math.sin(a),math.cos(a),0))
    mid=root+along*.13+Vector((0,0,h*.58)); tip=root+along*.4+Vector((0,0,h*.87))
    verts=[root-side*.03,root+side*.03,mid+side*.038,mid-side*.038,tip]
    back=[v-Vector((0,.006,0)) for v in verts]
    mesh('Bent sedge blade',verts+back,[(0,1,2,3),(3,2,4),(8,7,6,5),(9,7,8),(0,5,6,1),(1,6,7,2),(2,7,9,4),(4,9,8,3),(3,8,5,0)],'969263','b4ab7c')
    if i%3==0:
        end=root+along*.05+Vector((0,0,h+.12))
        beam('Reed stem',root,end,.012,'98905f',5)
        beam('Seedhead',end-Vector((0,0,.19)),end,.037,'6d6244',5)

start('basalt_columns','cinderreach')
# Interlocking irregular pillars share a talus foot; fracture lines never leave floating segments.
for x,y,r,h in [(-.64,.23,.38,1.34),(0,.34,.44,2.04),(.69,.22,.38,1.63),(-.31,-.31,.42,1.08),(.39,-.32,.41,1.39)]:
    sides=6; verts=[]
    phase=.13
    for scale,z,dx in [(1,-.06,0),(1.02,h*.4,.018),(.96,h*.43,.02),(.99,h*.87,.04),(.83,h,.08)]:
        for j in range(sides):
            a=j*math.tau/sides+phase
            verts.append((x+math.cos(a)*r*scale+dx,y+math.sin(a)*r*scale,z))
    faces=[]
    for layer in range(4):
        for j in range(sides):
            k=(j+1)%sides
            faces.append((layer*sides+j,layer*sides+k,(layer+1)*sides+k,(layer+1)*sides+j))
    faces.extend([tuple(range(24,30)),tuple(reversed(range(6)))])
    mesh('Chipped basalt column',verts,faces,'626a67','82866c','454e4c')
for x,y in [(-.78,-.37),(.84,-.38),(.06,-.73)]:
    ledge('Column talus',(x,y,0),.36,.31,'646c67','85896e',6)
start('basalt_scree','cinderreach')
for x,y,r,h in [(-.42,0,.65,.76),(.40,.15,.5,.59),(0,-.4,.34,.29)]:
    ledge('Fractured basalt erratic',(x,y,0),r,h,'606b67','848976',6)

# Exact Skerry geometry, with only snow recoloured for the snow-free biomes.
def skerry_variant(source_name, name, biome, snow_color):
    root=start(name,biome)
    with bpy.data.libraries.load(str(ROOT/'art/landscape.blend'),link=False) as (source,dest):
        dest.objects=[source_name+'_mesh']
    obj=dest.objects[0]
    if obj is None: raise RuntimeError('Missing Skerry source: '+source_name)
    # Appended objects have no evaluated world matrix until linked; retain authored local transforms.
    matrix=obj.matrix_basis.copy()
    obj.parent=root; obj.matrix_basis=matrix
    bpy.context.collection.objects.link(obj)
    obj.name=name+'_source'
    obj.data=obj.data.copy()
    obj.data.materials.clear(); obj.data.materials.append(material)
    attr=obj.data.color_attributes['Col']
    for point in attr.data:
        r,g,b,_=point.color
        if min(r,g,b)>.5:
            point.color=rgb(snow_color)+(1,)
    return obj
skerry_variant('granite_1','granite_dry_1','amberfen','a4aa85')
skerry_variant('granite_2','granite_dry_2','amberfen','a4aa85')
skerry_variant('spruce_coastal','spruce_dry','amberfen','62836a')
skerry_variant('juniper','juniper_dry','amberfen','9a9b75')

for root in roots:
    bpy.ops.object.select_all(action='DESELECT')
    children=list(root.children)
    for child in children: child.select_set(True)
    bpy.context.view_layer.objects.active=children[0]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    if len(children)>1: bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=root.name+'_mesh'
    obj.data.materials.clear(); obj.data.materials.append(material)
    for face in obj.data.polygons: face.material_index=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/biomes.blend'))
for root in roots:
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for child in root.children_recursive: child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(root.name+'.glb')),export_format='GLB',
        use_selection=True,export_yup=True,export_extras=True)
print('Exported eleven Skerry-family biome assets.')
