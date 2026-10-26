"""Home-screen graphics rendered from the game's own Blender kit.

Produces `art/home-vista.blend` and two kinds of images:
  public/art/interface/home-vista.jpg      a wide coastal vista behind the entrance
  public/art/interface/faction-<key>.png   each faction's signature structure in its paint

Run with `pnpm art:tactical home`. Blender is the editable source; nothing here is
downloaded and every model is original Noordheim work.
"""
import bpy, json, math, random
from pathlib import Path
from mathutils import Vector, noise

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/art/interface'
OUT.mkdir(parents=True, exist_ok=True)
random.seed(947)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
    for item in list(block):
        block.remove(item, do_unlink=True)

scene = bpy.context.scene
link = bpy.context.collection.objects.link


def srgb(hexcolor):
    channels = [int(hexcolor[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in channels)


def material(name, hexcolor, roughness=.9, **inputs):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = srgb(hexcolor) + (1,)
    p.inputs['Roughness'].default_value = roughness
    for key, value in inputs.items():
        p.inputs[key].default_value = value
    return m


# ---------------------------------------------------------------- terrain
HEATH, SNOW, STONE, GRAVEL, MARSH = (
    srgb('536456'), srgb('eaece2'), srgb('4a5651'), srgb('8c9381'), srgb('6b7550'))


def smooth(edge0, edge1, x):
    t = max(0, min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def height(x, y):
    p = Vector((x, y, 0))
    rolling = noise.fractal(p * .035, .9, 2.1, 4) * 2.4
    detail = noise.noise(p * .18) * .35
    ridge = 22 * smooth(34, 78, y + 7 * noise.noise(p * .02)) * (.75 + .25 * noise.noise(p * .05 + Vector((3, 3, 0))))
    ridge += 9 * smooth(60, 95, y)
    shoulder = 5 * smooth(28, 48, -x) * smooth(-30, 20, y)
    fjord = -6 * smooth(10, 34, -x - .35 * y) * smooth(30, -6, y)
    yard = 1 - smooth(9, 22, math.hypot(x - 1, y - 3))
    h = (rolling + detail) * (1 - .85 * yard) + ridge + shoulder + fjord
    return h


SIZE, STEP = 130, 1.5
N = int(SIZE * 2 / STEP)
verts, faces = [], []
for j in range(N + 1):
    for i in range(N + 1):
        x, y = -SIZE + i * STEP, -SIZE * .55 + j * STEP
        verts.append((x, y, height(x, y)))
for j in range(N):
    for i in range(N):
        a = j * (N + 1) + i
        faces.append((a, a + 1, a + N + 2, a + N + 1))
ground_mesh = bpy.data.meshes.new('Skerry ground')
ground_mesh.from_pydata(verts, [], faces)
ground_mesh.update()
ground = bpy.data.objects.new('Skerry ground', ground_mesh)
link(ground)
paint = ground_mesh.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
normals = [v.normal for v in ground_mesh.vertices]
for idx, v in enumerate(ground_mesh.vertices):
    x, y, z = v.co
    slope = 1 - normals[idx].z
    n = noise.noise(Vector((x * .09, y * .09, 0)))
    n2 = noise.noise(Vector((x * .03 + 9, y * .03, 0)))
    snow = smooth(.1, .5, n + .35 * n2 + .04 * z - .35 * slope * 10)
    if y > 48:
        snow = max(snow, smooth(48, 70, y + 6 * n))
    stone = smooth(.14, .3, slope)
    marsh = (1 - smooth(-1.2, .8, z)) * smooth(-.2, .3, n2)
    col = Vector(HEATH).lerp(Vector(MARSH), marsh)
    col = col.lerp(Vector(GRAVEL), (1 - smooth(9, 20, math.hypot(x - 1, y - 3))) * .8)
    col = col.lerp(Vector(SNOW), snow * (1 - stone * .7))
    col = col.lerp(Vector(STONE), stone)
    paint.data[idx].color = (*col, 1)
ground_mat = bpy.data.materials.new('Skerry ground')
ground_mat.use_nodes = True
nodes = ground_mat.node_tree.nodes
attr = nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'Col'
ground_mat.node_tree.links.new(attr.outputs['Color'], nodes['Principled BSDF'].inputs['Base Color'])
nodes['Principled BSDF'].inputs['Roughness'].default_value = .95
ground_mesh.materials.append(ground_mat)
ground_mesh.shade_smooth()

# Fjord water: a still, dark reflective sheet at the basin floor's waterline.
bpy.ops.mesh.primitive_plane_add(size=SIZE * 3, location=(0, 0, -1.1))
water = bpy.context.object
water.name = 'Fjord water'
water.data.materials.append(material('Fjord water', '1d3336', .06, Metallic=.15, **{'Specular IOR Level': .8}))

# ---------------------------------------------------------------- kit


def import_glb(folder, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/public/models/{folder}/{name}.glb')
    added = set(bpy.data.objects) - before
    parent = bpy.data.objects.new(f'{name} source', None)
    link(parent)
    for o in added:
        if o.parent not in added:
            o.parent = parent
        if o.type == 'MESH':
            o.data.shade_smooth() if 'spruce' not in name and 'juniper' not in name else None
    parent.hide_render = True
    parent.hide_viewport = True
    for o in added:
        o.hide_render = True
        o.hide_viewport = True
    return parent, added


library = {}


def place(folder, name, loc, scale=1, angle=0, ground_z=True):
    """Instance a kit asset by linked duplicates so one mesh serves every copy."""
    if (folder, name) not in library:
        library[(folder, name)] = import_glb(folder, name)
    parent, added = library[(folder, name)]
    copies = {}
    for o in added:
        c = o.copy()
        c.hide_render = False
        c.hide_viewport = False
        link(c)
        copies[o] = c
    root = bpy.data.objects.new(f'{name}', None)
    link(root)
    for o, c in copies.items():
        c.parent = copies.get(o.parent, root)
    x, y, z = loc
    if ground_z:
        z = height(x, y) + z
    root.location = (x, y, z)
    root.scale = (scale, scale, scale)
    root.rotation_euler.z = angle
    return root


# Field base in the yard. Northern Command's kit, scaled as in play.
place('tactical', 'hq', (0, 4, .05), 1, -.15)
place('tactical', 'barracks', (12.5, 9.5, .05), 1, .1)
place('tactical', 'factory', (-13.5, 12, .05), 1, .25)
place('tactical', 'refinery', (13, -3, .05), 1, -.4)
place('tactical', 'reactor', (-8, 19, .05), 1, .6)
place('tactical', 'turret', (-14, -6, .05), 1, -.9)
place('tactical', 'turret', (21, 3, .05), 1, .3)
place('tactical', 'harvester', (5, -9, .08), 1, .9)
place('tactical', 'harvester', (17, -8, .08), 1, 2.4)
place('tactical', 'lynx', (-6, -6, .05), 1, -.65)
place('tactical', 'lynx', (-9.5, -3.5, .05), 1, -.5)
place('tactical', 'tank', (-3, -12, .05), 1, .3)
place('tactical', 'howitzer', (8, 15, .05), 1, 2.8)
place('tactical', 'gunship', (-22, -2, 9), 1, .4, ground_z=True)
for i, (x, y) in enumerate([(-2.5, -8.5), (-1.5, -9.2), (3.5, 1), (10, 3), (7.5, -1.5)]):
    place('tactical', 'ranger', (x, y, .02), 1, random.uniform(0, 6.28))
for i, (x, y, a) in enumerate([(19, -10, .2), (21.5, -14, -.7), (-18, 4, 1.4)]):
    place('ore', f'ironstone_{i % 3 + 1}', (x, y, .02), 1.2, a)
place('landscape', 'field_stores', (6, 11, .02), 1.1, .3)
place('landscape', 'field_stores', (-4, 14, .02), 1, -1.2)
for i in range(6):
    place('landscape', 'field_fence', (-19 + i * 3.4, -12.5 + i * .1, .02), 1, .04)

# Forest, granite and juniper follow the terrain: dense on the slopes, thin on the ridge, none in the water.
spruces = ['spruce_coastal', 'spruce_young', 'spruce_windswept']
count = 0
attempts = 0
while count < 520 and attempts < 6000:
    attempts += 1
    x = random.uniform(-SIZE, SIZE)
    y = random.uniform(-SIZE * .55, SIZE)
    z = height(x, y)
    if z < .2 or math.hypot(x - 1, y - 3) < 24:
        continue
    if y > 62 and random.random() < .8:
        continue
    if random.random() > .35 + .65 * smooth(8, 40, y) + .3 * smooth(20, 45, abs(x)):
        continue
    kind = spruces[count % 3] if random.random() > .12 else 'juniper'
    scale = random.uniform(1.4, 2.4) * (1 - .3 * smooth(50, 80, y))
    place('landscape', kind, (x, y, 0), scale, random.uniform(0, 6.28))
    count += 1
for i in range(70):
    x = random.uniform(-SIZE, SIZE)
    y = random.uniform(-SIZE * .55, SIZE)
    z = height(x, y)
    if z < -.6 or math.hypot(x - 1, y - 3) < 20:
        continue
    place('landscape', f'granite_{i % 2 + 1}', (x, y, -.1), random.uniform(1.4, 3.6), random.uniform(0, 6.28))

# ---------------------------------------------------------------- light, air, camera
bpy.ops.object.light_add(type='SUN', location=(-40, -10, 60))
sun = bpy.context.object
sun.data.energy = 4.4
sun.data.color = srgb('fff1dc')
sun.data.angle = math.radians(2.5)
sun.rotation_euler = (Vector((0, 0, 0)) - Vector((-60, -28, 42))).to_track_quat('-Z', 'Y').to_euler()

world = bpy.data.worlds.new('Skerry sky') if not scene.world else scene.world
scene.world = world
world.use_nodes = True
wn = world.node_tree.nodes
wl = world.node_tree.links
for n in list(wn):
    wn.remove(n)
out = wn.new('ShaderNodeOutputWorld')
bg = wn.new('ShaderNodeBackground')
ramp = wn.new('ShaderNodeValToRGB')
sep = wn.new('ShaderNodeSeparateXYZ')
coord = wn.new('ShaderNodeTexCoord')
ramp.color_ramp.elements[0].position = .0
ramp.color_ramp.elements[0].color = srgb('b3c4b6') + (1,)
mid = ramp.color_ramp.elements.new(.1)
mid.color = srgb('5f7f76') + (1,)
ramp.color_ramp.elements[-1].position = .5
ramp.color_ramp.elements[-1].color = srgb('1d383b') + (1,)
wl.new(coord.outputs['Generated'], sep.inputs['Vector'])
wl.new(sep.outputs['Z'], ramp.inputs['Fac'])
wl.new(ramp.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 1.35
wl.new(bg.outputs['Background'], out.inputs['Surface'])

# Bounded coastal mist: a scatter volume over the whole vista, thicker near the water.
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 40, 14))
mist = bpy.context.object
mist.name = 'Coastal mist'
mist.scale = (SIZE * 2.2, SIZE * 1.8, 34)
mist.display_type = 'WIRE'
mist_mat = bpy.data.materials.new('Coastal mist')
mist_mat.use_nodes = True
mn = mist_mat.node_tree.nodes
ml = mist_mat.node_tree.links
for n in list(mn):
    mn.remove(n)
mout = mn.new('ShaderNodeOutputMaterial')
scatter = mn.new('ShaderNodeVolumeScatter')
scatter.inputs['Color'].default_value = srgb('c6d5cd') + (1,)
scatter.inputs['Density'].default_value = .0042
scatter.inputs['Anisotropy'].default_value = .35
ml.new(scatter.outputs['Volume'], mout.inputs['Volume'])
mist.data.materials.append(mist_mat)

bpy.ops.object.camera_add(location=(-26, -46, 13.5))
camera = bpy.context.object
camera.name = 'Vista camera'
scene.camera = camera
camera.data.lens = 32
camera.data.sensor_width = 36
camera.rotation_euler = (Vector((4, 22, 5.5)) - camera.location).to_track_quat('-Z', 'Y').to_euler()

# Render setup: Cycles on Metal where available, denoised, film opaque.
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = True
    scene.cycles.device = 'GPU'
except Exception as error:  # CPU rendering still produces the same images.
    print('GPU unavailable, rendering on CPU:', error)
scene.cycles.samples = 96
scene.cycles.use_denoising = True
scene.cycles.volume_step_rate = 2
scene.cycles.volume_max_steps = 256
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = .3
scene.render.resolution_percentage = 100
scene.render.film_transparent = False
scene.render.resolution_x, scene.render.resolution_y = 2560, 1440
scene.render.image_settings.file_format = 'JPEG'
scene.render.image_settings.quality = 82
scene.render.image_settings.color_mode = 'RGB'
scene['NOORDHEIM_HOME_CONCEPT'] = (
    'A low winter sun over the Skerry front: Northern Command\'s field base in the yard, '
    'spruce slopes, coastal mist and the ridge behind. Timber red, slate, warm ivory snow, pine dark sky.')
bpy.ops.wm.save_as_mainfile(filepath=f'{ROOT}/art/home-vista.blend')
scene.render.filepath = str(OUT / 'home-vista.jpg')
bpy.ops.render.render(write_still=True)
print('Home vista rendered.')

# ---------------------------------------------------------------- faction badges
# Each faction's signature structure in its own paint on a granite plinth, transparent background.
for o in list(bpy.data.objects):
    if o not in (camera, sun):
        bpy.data.objects.remove(o, do_unlink=True)
cultures = json.loads((ROOT / 'art/cultures.json').read_text())
signatures = {'fjordborn': 'camp', 'ironclad': 'armory', 'hearthkin': 'depot', 'ashwalkers': 'watchtower'}
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 720, 540
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.cycles.samples = 64
camera.data.type = 'ORTHO'
sun.rotation_euler = (Vector((0, 0, 0)) - Vector((5, -7, 10))).to_track_quat('-Z', 'Y').to_euler()
sun.data.energy = 4.2
for n in list(wn):
    wn.remove(n)
out = wn.new('ShaderNodeOutputWorld')
bg = wn.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = srgb('a9bdb2') + (1,)
bg.inputs['Strength'].default_value = 1.1
wl.new(bg.outputs['Background'], out.inputs['Surface'])
scene.view_settings.exposure = .15
granite = material('Badge granite', '5b6a64', .95)
snow = material('Badge snow', 'e6e9dc', .9)
heath = material('Badge heath', '5f7160', .95)
BADGE = {'camp': (9.8, 2.1), 'armory': (9, 1.8), 'depot': (9, 2.2), 'watchtower': (10.5, 4.2)}
for key, kind in signatures.items():
    for o in list(bpy.data.objects):
        if o not in (camera, sun):
            bpy.data.objects.remove(o, do_unlink=True)
    library.clear()
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=5.6, depth=1.2, location=(0, 0, -.62))
    plinth = bpy.context.object
    plinth.name = 'Plinth'
    plinth.data.materials.append(granite)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=5.3, depth=.08, location=(0, 0, .0))
    top = bpy.context.object
    top.name = 'Plinth heath'
    top.data.materials.append(heath)
    for i, (x, y, r) in enumerate([(-3.4, 1.6, 2), (2.8, -2.8, 1.8), (1.6, 3.4, 1.9)]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=13, radius=r, depth=.06, location=(x, y, .05))
        drift = bpy.context.object
        drift.scale = (1, .75, 1)
        drift.rotation_euler.z = i * 1.1
        drift.data.materials.append(snow)
    root = place('tactical', kind, (0, 0, .06), 1, 0, ground_z=False)
    primary = srgb(cultures[key]['primary'])
    for o in root.children_recursive:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if m and m.name.startswith('culture_trim'):
                m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = primary + (1,)
                m.node_tree.nodes['Principled BSDF'].inputs['Emission Color'].default_value = primary + (1,)
                m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = .25
    size, target_z = BADGE[kind]
    focus = Vector((0, 0, target_z))
    camera.location = focus + Vector((size, -size * 1.35, size * .95))
    camera.data.ortho_scale = size * 1.25
    camera.rotation_euler = (focus - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / f'faction-{key}.png')
    bpy.ops.render.render(write_still=True)
    print('Faction badge rendered:', key)
print('Home graphics complete.')
