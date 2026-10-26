"""Author the Skerry landing-zone kit. Blender is the editable/exportable source.

Sculpted boughs, bent trunks, fractured granite and field stores use one vertex-colour
material per asset. No alpha cards: silhouettes and shadows agree at every zoom.
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
roots = []
rng = random.Random(947)

def linear(v):
    return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

def color(h):
    return tuple(linear(int(h[i:i+2], 16) / 255) for i in (0, 2, 4))

PALETTE = {k: color(v) for k, v in {
    'bark': '665444', 'branch': '635747', 'deep': '30483d',
    'needle': '426653', 'tip': '62836a', 'snow': 'e0e4d9',
    'stone': '7b807b', 'lichen': 'a4aa85', 'heather': '6d7150',
    'wood': '8c7356', 'red': '8b4d37', 'steel': '485357',
    'strap': '344444', 'sand': '9a9876',
}.items()}
material = bpy.data.materials.new('Skerry baked colour')
material.use_nodes = True
nodes = material.node_tree.nodes
vertex = nodes.new('ShaderNodeVertexColor')
vertex.layer_name = 'Col'
bsdf = nodes.get('Principled BSDF')
material.node_tree.links.new(vertex.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = .9

def start(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root['ambient_only'] = True
    roots.append(root)

def finish(obj, name, shade, vary=.12):
    obj.name = name
    obj.parent = roots[-1]
    obj.data.materials.clear()
    obj.data.materials.append(material)
    attr = obj.data.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')
    base = PALETTE[shade] if isinstance(shade, str) else shade
    for poly in obj.data.polygons:
        # Authored underside occlusion and small patch variation survive GLB export.
        lum = (1 - vary / 2 + rng.random() * vary) * (.78 + .22 * max(0, poly.normal.z))
        for index in poly.loop_indices:
            attr.data[index].color = tuple(min(1, c * lum) for c in base) + (1,)
    return obj

def mesh(name, vertices, faces, shade):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, shade)

def beam(name, a, b, radius, shade, sides=7):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=radius, radius2=radius*.62,
                                  depth=(b-a).length, location=(a+b)/2)
    obj = bpy.context.object
    obj.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(obj, name, shade)

def box(name, position, size, shade, bevel=.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        m = obj.modifiers.new('Worn edges', 'BEVEL')
        m.width = bevel
        m.segments = 1
        bpy.ops.object.modifier_apply(modifier=m.name)
    return finish(obj, name, shade)

def spray(center, angle, length, width, shade):
    """A thick, toothed fan of needles, with an irregular upper ridge."""
    c = Vector(center)
    forward = Vector((math.cos(angle), math.sin(angle), -.13))
    side = Vector((-math.sin(angle), math.cos(angle), 0))
    verts = [c + Vector((0, 0, .10)), c + forward * length]
    for i in range(5):
        t = i / 4
        w = width * math.sin((.15 + .8*t)*math.pi) * rng.uniform(.65, 1.15)
        for sign in (-1, 1):
            verts.append(c + forward * (length*t) + side*w*sign + Vector((0, 0, -.035)))
    faces = []
    for i in range(4):
        faces.extend([(0, 2+i*2, 4+i*2), (0, 5+i*2, 3+i*2)])
    faces.extend([(0, 10, 1), (0, 1, 11), (2, 3, 1)])
    return mesh('Needle spray', verts, faces, shade)

def spruce(name, height, lean, fullness):
    """Solid scalloped bough tiers: readable from every heading, under 850 triangles."""
    start(name)
    def axis(z):
        return Vector((lean*(z/height)**1.7, math.sin(z*1.5)*.04, z))
    for i in range(4):
        beam('Bent trunk', axis(i*height/4), axis((i+1)*height/4),
             .105*(1-i/4)+.018, 'bark', 7)
    for level in range(7):
        z = .48 + level*(height-.82)/7
        extent = fullness*(1-z/height)**.72
        tier_height = min(.95, (height-z)*.64)
        center = axis(z)
        phase = level*2.399
        sides = 12
        radii = [extent*rng.uniform(.84,1.13)*(1 if j%2 else .84) for j in range(sides)]
        vertices = [center + Vector((lean*.12, 0, tier_height))]
        for ring in range(2):
            for j in range(sides):
                angle = j*math.tau/sides+phase
                r = radii[j]*(.66 if ring==0 else 1)
                dz = tier_height*.38 if ring==0 else -.06-(.10 if j%2 else 0)
                vertices.append(center+Vector((math.cos(angle)*r,math.sin(angle)*r,dz)))
        vertices.append(center + Vector((0,0,-.04)))
        faces=[]
        for j in range(sides):
            k=(j+1)%sides
            faces.extend([(0,1+j,1+k), (1+j,13+j,13+k,1+k), (25,13+k,13+j)])
        obj=mesh('Sculpted spruce bough',vertices,faces,'needle' if level%3 else 'deep')
        # Continuous snow shelves lie on the upper bough, never floating cards.
        if level in (1,3,5,6):
            snowverts=[vertices[0]+Vector((0,0,.025))]
            for j in range(sides):
                snowverts.append(vertices[0].lerp(vertices[1+j], .85 if j%3 else .68)+Vector((0,0,.025)))
            mesh('Settled snow',snowverts,[(0,1+j,1+(j+1)%sides) for j in range(sides)],'snow',)
    beam('Leader',axis(height-.45),axis(height),.085,'needle',6)

spruce('spruce_coastal', 3.8, .16, 1.25)
spruce('spruce_windswept', 3.4, .44, 1.35)
spruce('spruce_young', 2.7, -.08, .85)

for index in range(2):
    start('granite_' + str(index+1))
    # Broad fractured faces and a continuous pale top replace speckled triangles.
    for part in range(3 if index == 0 else 2):
        center=Vector(((part-1)*.48, rng.uniform(-.18,.18), .02))
        radius=.80 if part==0 else .62
        sides=7
        phase=rng.uniform(-.4,.4)
        ring=[radius*rng.uniform(.85,1.12) for j in range(sides)]
        verts=[]
        for scale,z in [(1,-.05),(1.04,.33),(.75,.80 if part==0 else .63)]:
            for j in range(sides):
                angle=j*math.tau/sides+phase
                verts.append(center+Vector((math.cos(angle)*ring[j]*scale,math.sin(angle)*ring[j]*scale,z)))
        faces=[]
        for layer in range(2):
            for j in range(sides):
                k=(j+1)%sides
                faces.append((layer*sides+j,layer*sides+k,(layer+1)*sides+k,(layer+1)*sides+j))
        faces.append(tuple(range(14,21)))
        faces.append(tuple(reversed(range(7))))
        obj=mesh('Sculpted granite ledge',verts,faces,'stone')
        attr=obj.data.color_attributes['Col']
        for face in obj.data.polygons:
            if face.normal.z>.9:
                shade=PALETTE['snow' if part==0 else 'lichen']
                for i in face.loop_indices:attr.data[i].color=shade+(1,)

start('juniper')
for branch in range(14):
    a = rng.random()*math.tau
    r = rng.uniform(.2, .75)
    end = (math.cos(a)*r, math.sin(a)*r, rng.uniform(.18, .48))
    beam('Juniper stem', (0,0,0), end, .022, 'branch', 5)
    spray(end, a, .38, .16, 'heather' if branch % 3 == 0 else 'needle')

start('field_stores')
for x, y, z in [(-.55,0,.3), (.45,.1,.3), (-.45,.1,.9)]:
    box('Supply crate', (x,y,z), (.85,.72,.57), 'wood')
    for off in [-.27,.27]:
        box('Crate strap', (x+off,y,z), (.055,.75,.6), 'strap', .008)
    for off in [-.15,.05]:
        box('Plank joint', (x,y-.363,z+off), (.79,.012,.018), 'bark', 0)
for x, y in [(1.1,.05),(1.15,.66)]:
    beam('Fuel drum', (x,y,.08), (x,y,.85), .27, 'red', 16)
    for z in [.22,.64]:
        beam('Drum band', (x,y,z), (x,y,z+.055), .28, 'steel', 16)

start('field_fence')
for x in [-1.6, 0, 1.6]:
    box('Timber post', (x,0,.64), (.16,.16,1.28), 'wood')
for z in [.45,.94]:
    box('Fence rail', (0,-.04,z), (3.4,.12,.14), 'wood')
beam('Diagonal brace', (-1.6,-.1,.3), (0,-.1,1.08), .045, 'bark')
beam('Diagonal brace', (0,-.1,.3), (1.6,-.1,1.08), .045, 'bark')

start('bridge_span')
box('Bridge deck',(0,0,.35),(10.5,16,.5),'steel',.07)
for side in [-1,1]:
    x=side*5.04
    beam('Upper chord',(x,-8,2.3),(x,8,2.3),.12,'steel',6)
    beam('Lower chord',(x,-8,.83),(x,8,.83),.10,'steel',6)
    for i in range(7):
        y=-8+i*16/6
        beam('Truss upright',(x,y,.67),(x,y,2.3),.11,'steel',6)
        if i<6:
            beam('Diagonal truss',(x,y,.83 if i%2 else 2.3),
                 (x,y+16/6,2.3 if i%2 else .83),.10,'steel',6)
    for y in [-7.35,7.35]:
        box('Granite bridge footing',(side*4.5,y,-.20),(1.1,1.3,1.4),'stone',.09)
    box('Lane stripe',(side*2.4,0,.606),(.11,13,.012),'sand',0)
for y in [-7.6,-4,0,4,7.6]:
    box('Deck expansion joint',(0,y,.605),(9.7,.055,.011),'strap',0)

# Apply transforms, join into one draw call per variant and keep every source root editable.
for root in roots:
    bpy.ops.object.select_all(action='DESELECT')
    for child in root.children:
        child.select_set(True)
    bpy.context.view_layer.objects.active = root.children[0]
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = root.name + '_mesh'
    # Exporters can otherwise create one primitive for every duplicate material slot.
    obj.data.materials.clear()
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.material_index = 0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/landscape.blend'))
for root in roots:
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(root.name+'.glb')), export_format='GLB',
        use_selection=True, export_yup=True, export_extras=True)
print('Skerry landscape: nine Blender assets exported.')
