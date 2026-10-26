"""Faction badges for the enrolment card: each faction's two signature troops in
its own paint on a granite plinth, transparent background. Replaces the earlier
structure badges so the picker shows people, not buildings.
Run: Blender --background --factory-startup --python art/blender/render_faction_badges.py
"""
import bpy, json, math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/art/interface'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene


def srgb(hexcolor):
    def linear(c):
        return c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4
    return tuple(linear(int(hexcolor[i:i + 2], 16) / 255) for i in (0, 2, 4))


def material(name, hexcolor, roughness=.9):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = srgb(hexcolor) + (1,)
    p.inputs['Roughness'].default_value = roughness
    return m


def place(kind, loc, angle, primary):
    """Import one kit asset, paint its culture trim and stand it on the plinth."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT / 'public/models/tactical' / f'{kind}.glb'))
    added = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in added if o.parent is None or o.parent not in added)
    root.location = loc
    root.rotation_euler.z = angle
    for o in added:
        if o.type != 'MESH':
            continue
        for slot in o.material_slots:
            m = slot.material
            if m and m.name.startswith('culture_trim'):
                m = m.copy()
                slot.material = m
                p = m.node_tree.nodes['Principled BSDF']
                p.inputs['Base Color'].default_value = primary + (1,)
                p.inputs['Emission Color'].default_value = primary + (1,)
                p.inputs['Emission Strength'].default_value = .25
    return added


scene.render.engine = 'CYCLES'
scene.cycles.samples = 96
scene.render.film_transparent = True
scene.render.resolution_x, scene.render.resolution_y = 720, 540
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.view_settings.exposure = .15
world = bpy.data.worlds.new('Badge world')
scene.world = world
world.use_nodes = True
wn, wl = world.node_tree.nodes, world.node_tree.links
for n in list(wn):
    wn.remove(n)
out = wn.new('ShaderNodeOutputWorld')
bg = wn.new('ShaderNodeBackground')
bg.inputs['Color'].default_value = srgb('a9bdb2') + (1,)
bg.inputs['Strength'].default_value = 1.1
wl.new(bg.outputs['Background'], out.inputs['Surface'])
bpy.ops.object.light_add(type='SUN', location=(5, -7, 10))
sun = bpy.context.object
sun.data.energy = 4.2
sun.data.angle = math.radians(3)
sun.rotation_euler = (Vector((0, 0, 0)) - Vector((5, -7, 10))).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.camera_add()
camera = bpy.context.object
scene.camera = camera
camera.data.type = 'ORTHO'
granite = material('Badge granite', '5b6a64', .95)
snow = material('Badge snow', 'e6e9dc', .9)
heath = material('Badge heath', '5f7160', .95)
cultures = json.loads((ROOT / 'art/cultures.json').read_text())
# Infantry front left, vehicle behind right; both turned toward the camera.
TROOPS = {
    'fjordborn': ('raider', 'snowmobile'),
    'ironclad': ('sapper', 'mortar'),
    'hearthkin': ('militia', 'bulwark'),
    'ashwalkers': ('marksman', 'fenrir'),
}
keep = {camera, sun}
for key, (infantry, vehicle) in TROOPS.items():
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=4.2, depth=1.0, location=(0, 0, -.52))
    plinth = bpy.context.object
    plinth.data.materials.append(granite)
    bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=3.95, depth=.08, location=(0, 0, 0))
    bpy.context.object.data.materials.append(heath)
    for i, (x, y, r) in enumerate([(-2.4, 1.4, 1.4), (2.1, -2.0, 1.2), (1.2, 2.6, 1.3)]):
        bpy.ops.mesh.primitive_cylinder_add(vertices=13, radius=r, depth=.06, location=(x, y, .05))
        drift = bpy.context.object
        drift.scale = (1, .75, 1)
        drift.rotation_euler.z = i * 1.1
        drift.data.materials.append(snow)
    primary = srgb(cultures[key]['primary'])
    place(infantry, (-1.35, -1.1, .06), math.radians(200), primary)
    place(vehicle, (0.7, 1.4, .06), math.radians(215), primary)
    focus = Vector((0, 0, 1.5))
    size = 5.6
    camera.location = focus + Vector((size, -size * 1.35, size * .8))
    camera.data.ortho_scale = size * 1.5
    camera.rotation_euler = (focus - camera.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(OUT / f'faction-{key}.png')
    bpy.ops.render.render(write_still=True)
    print('Faction badge rendered:', key)
print('Faction badges complete.')
