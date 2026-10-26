"""Original Nordic coastal life: editable gull rig, maintenance crew and shore dressing.
Run Blender --background --python-exit-code 1 --python art/blender/create_environment.py.
"""
import bpy, math, random
from pathlib import Path
from mathutils import Vector
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models/environment'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
M = {}
for name, rgb in {'feathers':'d5d7cc','wingtip':'344249','beak':'cdb575','orange':'c07a3f',
                  'cloth':'364c51','boots':'263438','reflective':'d7d1ac','skin':'ae917a',
                  'stone':'67736d','lichen':'a5aa80','grass':'8a9066','heather':'817267'}.items():
    linear = lambda c: c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4
    rgba = tuple(linear(int(rgb[i:i+2], 16)/255) for i in (0,2,4)) + (1,)
    m = bpy.data.materials.new(name); m.use_nodes = True; m.diffuse_color = rgba
    m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = rgba
    m.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = .86
    M[name] = m
roots = []
root = None

def empty(name, parent=None, location=(0,0,0)):
    o = bpy.data.objects.new(name, None); bpy.context.collection.objects.link(o)
    o.parent = parent; o.location = location
    return o

def start(name):
    global root
    root = empty(name); roots.append(root)
    root['ambient_only'] = True

def finish(o, name, mat, parent=None):
    o.name = name; o.parent = parent or root; o.data.materials.append(M[mat])
    return o

def sphere(name, pos, scale, mat, parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, location=pos)
    o = finish(bpy.context.object, name, mat, parent); o.scale = scale
    for p in o.data.polygons: p.use_smooth = True
    return o

def box(name, pos, scale, mat, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    o = finish(bpy.context.object, name, mat, parent); o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    m = o.modifiers.new('Soft edges', 'BEVEL'); m.width = .035; m.segments = 2
    o.modifiers.new('Normals', 'WEIGHTED_NORMAL')
    return o

def mesh(name, verts, faces, mat, parent=None):
    data = bpy.data.meshes.new(name); data.from_pydata(verts, [], faces); data.update()
    o = bpy.data.objects.new(name, data); bpy.context.collection.objects.link(o)
    return finish(o, name, mat, parent)

start('gull')
sphere('Body', (0,0,0), (.21,.48,.2), 'feathers')
sphere('Neck', (0,-.35,.12), (.14,.19,.19), 'feathers')
sphere('Head', (0,-.5,.2), (.15,.18,.15), 'feathers')
sphere('Bill', (0,-.71,.18), (.06,.14,.045), 'beak')
for side in (-1,1):
    sphere('Eye', (side*.125,-.56,.23), (.021,.022,.023), 'wingtip')
    pivot = empty('wing_left' if side < 0 else 'wing_right', root, (side*.12,0,0))
    # Swept feathers have thickness and a tapered silhouette; pivot survives export.
    verts = [(side*x,y,z) for x,y,z in [(0,-.2,0),(.5,-.25,.04),(1,-.04,.02),(1.38,.42,0),(.67,.27,-.02),(0,.19,0)]]
    verts += [(x,y,z-.035) for x,y,z in verts]
    faces = [(0,1,4,5),(1,2,3,4),(6,11,10,7),(7,10,9,8),(0,6,7,1),(1,7,8,2),(2,8,9,3),(3,9,10,4),(4,10,11,5),(5,11,6,0)]
    wing = mesh('Feathered wing', verts, faces, 'feathers', pivot)
    wing.data.materials.append(M['wingtip'])
    for i in (1,3,6,7): wing.data.polygons[i].material_index = 1
mesh('Tail', [(-.14,.3,0),(.14,.3,0),(.25,.72,.02),(-.25,.72,.02)], [(0,1,2,3),(3,2,1,0)], 'feathers')

start('technician')
for side in (-1,1):
    pivot = empty('leg_left' if side < 0 else 'leg_right', root, (side*.18,0,.87))
    box('Work trousers', (0,0,-.31), (.25,.3,.64), 'cloth', pivot)
    box('Safety stripe', (0,-.01,-.46), (.265,.315,.07), 'reflective', pivot)
    box('Winter boot', (0,-.075,-.73), (.28,.47,.24), 'boots', pivot)
box('Insulated parka', (0,0,1.15), (.73,.48,.67), 'orange')
box('Reflective waist', (0,-.245,1.02), (.68,.025,.065), 'reflective')
for x in (-.22,.22): box('Reflective chest', (x,-.25,1.26), (.065,.025,.4), 'reflective')
sphere('Face', (0,-.03,1.68), (.2,.18,.24), 'skin')
sphere('Wool cap', (0,.015,1.84), (.225,.21,.15), 'cloth')
box('Cap brim', (0,-.09,1.78), (.43,.32,.065), 'cloth')
box('Collar', (0,0,1.49), (.46,.39,.14), 'cloth')
for side in (-1,1):
    pivot = empty('arm_left' if side < 0 else 'arm_right', root, (side*.43,0,1.4))
    sphere('Sleeve', (0,0,-.23), (.14,.17,.32), 'orange', pivot)
    sphere('Glove', (0,-.015,-.51), (.11,.12,.13), 'boots', pivot)
    if side > 0: box('Tool case', (0,0,-.78), (.2,.54,.3), 'cloth', pivot)

rng = random.Random(148)
start('shore_patch')
for j in range(5):
    x,y = rng.uniform(-1.1,1.1),rng.uniform(-.7,.7)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=(x,y,.17))
    o = finish(bpy.context.object,'Weathered granite','stone'); o.scale=(rng.uniform(.3,.8),rng.uniform(.3,.7),rng.uniform(.2,.48))
    o.rotation_euler=(rng.random()*.2,rng.random()*.2,rng.random()*6)
    o.data.materials.append(M['lichen'])
    for p in o.data.polygons:
        if p.normal.z > .3 and rng.random() > .5: p.material_index = 1
for j in range(20):
    x,y = rng.uniform(-1.5,1.5),rng.uniform(-1,1); h=rng.uniform(.3,.75); bend=rng.uniform(.05,.3)
    mesh('Coastal sedge',[(x-.035,y,0),(x+.035,y,0),(x+bend,y+.07,h),(x+.035,y,0),(x-.035,y,0),(x+bend,y+.07,h)],[(0,1,2),(3,4,5)],'grass')
for j in range(4):
    sphere('Low heather',(rng.uniform(-1.2,1.2),rng.uniform(-1,1),.14),(.3,.24,.17),'heather')

# Join rigid pieces by material under each pivot; retain the articulated nodes.
for assembly in roots:
    for parent in [assembly] + [o for o in assembly.children_recursive if o.type == 'EMPTY']:
        groups={}
        for o in list(parent.children):
            if o.type != 'MESH': continue
            bpy.context.view_layer.objects.active=o
            for modifier in list(o.modifiers): bpy.ops.object.modifier_apply(modifier=modifier.name)
            key=tuple(m.name for m in o.data.materials); groups.setdefault(key,[]).append(o)
        for pieces in groups.values():
            bpy.ops.object.select_all(action='DESELECT')
            for o in pieces:o.select_set(True)
            bpy.context.view_layer.objects.active=pieces[0]
            if len(pieces)>1:bpy.ops.object.join()
            pieces[0].name=parent.name+'_'+pieces[0].data.materials[0].name
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/environment.blend'))
for assembly in roots:
    bpy.ops.object.select_all(action='DESELECT');assembly.select_set(True)
    for child in assembly.children_recursive:child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(assembly.name+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
print('Exported original coastal environment assets.')
