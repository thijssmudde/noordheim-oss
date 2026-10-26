"""A small, orbitable command-post diorama built from the game's Blender kit.
Run with scripts/blender-mcp.py menu. No textures or animation loops required.
"""
import bpy
import math
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def material(name, hexcolor):
    m=bpy.data.materials.new(name)
    channels=[int(hexcolor[i:i+2],16)/255 for i in (0,2,4)]
    rgba=tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in channels)+(1,)
    m.diffuse_color=rgba
    m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=rgba;p.inputs['Roughness'].default_value=.95
    return m
earth=material('Menu · heath','536456')
granite=material('Menu · granite edge','424f49')
snow=material('Menu · warm snow','d8dccb')
road=material('Menu · gravel','8c9381')

def patch(name, x,y, radius, mat, height=.05, seed=0, squash=1):
    n=13;verts=[(x,y,height)]
    for i in range(n):
        a=i*math.tau/n;r=radius*(.83+.12*math.sin(i*2.8+seed)+.05*math.cos(i*1.4))
        verts.append((x+math.cos(a)*r,y+math.sin(a)*r*squash,height))
    faces=[(0,i+1,(i+1)%n+1) for i in range(n)]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(mat)

# A continuous rocky cutaway reads as a physical tabletop from any heading.
bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=17,depth=1.3,location=(0,0,-.68))
island=bpy.context.object;island.name='Granite island';island.scale=(1,1.05,1);island.data.materials.append(granite)
patch('Heath',0,0,17.2,earth,.001,3,1.05)
patch('Dispatch yard',0,-4,10,road,.022,8,.57)
for i,(x,y,r) in enumerate([(-11,2,5),(8,6,6),(-3,11,6),(10,-7,4),(-9,-9,3),(2,3,3)]):
    patch('Snow drift',x,y,r,snow,.042,i,.8)

def asset(folder,name,loc,scale=1,angle=0):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f'{ROOT}/public/models/{folder}/{name}.glb')
    added=set(bpy.data.objects)-before
    parent=bpy.data.objects.new('Menu '+name,None);bpy.context.collection.objects.link(parent)
    for o in added:
        if o.parent not in added:o.parent=parent
    parent.location=loc;parent.scale=(scale,scale,scale);parent.rotation_euler.z=angle

asset('tactical','hq',(-3,1,.06),1.05)
asset('tactical','barracks',(5,6,.06),.78,-.1)
asset('tactical','harvester',(4,-5,.08),1.05,.9)
asset('tactical','lynx',(-6,-7,.06),.85,-.65)
for i,(x,y,s) in enumerate([(-11,6,1.6),(-9,10,1.8),(-5,12,1.6),(0,13,1.8),(10,7,1.8),(12,3,1.6),(-13,-2,1.5),(11,-4,1.2)]):
    asset('landscape',['spruce_coastal','spruce_young','spruce_windswept'][i%3],(x,y,.06),s,i*.7)
for i,(x,y,s) in enumerate([(-10,-6,1.8),(10,-9,1.6),(9,10,1.5),(-12,3,1.5),(3,12,1.5)]):
    asset('landscape',f'granite_{i%2+1}',(x,y,.06),s,i)

bpy.context.scene['NOORDHEIM_MENU_CONCEPT']='An orbitable Nordic command post: red timber, slate roofs, sculpted spruce, fractured granite, warm ivory snow. Match the playable world. Matte pine interface, ivory typography, restrained brass.'
for name in ['noordheim-home.png','noordheim-hud.png']:
    reference=bpy.data.images.load(f'{ROOT}/art/concepts/{name}',check_existing=True);reference.pack()
bpy.ops.wm.save_as_mainfile(filepath=f'{ROOT}/art/menu-diorama.blend')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=f'{ROOT}/public/models/menu/command-post.glb',export_format='GLB',use_selection=True,export_yup=True)
print('Orbitable command-post diorama exported.')

# A real Blender render keeps the scene visible while WebGL loads or is unavailable.
from mathutils import Vector
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.render.resolution_x=1280;scene.render.resolution_y=640;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
scene.world.color=(.25,.30,.25)
bpy.ops.object.camera_add(location=(18,-26,22));camera=bpy.context.object;scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=40
camera.rotation_euler=(Vector((0,0,1))-camera.location).to_track_quat('-Z','Y').to_euler()
for loc,energy,size in [((-12,-10,26),3400,14),((16,10,18),1800,12)]:
    bpy.ops.object.light_add(type='AREA',location=loc);light=bpy.context.object;light.data.energy=energy;light.data.size=size
    light.rotation_euler=(Vector((0,0,0))-light.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.wm.save_as_mainfile(filepath=f'{ROOT}/art/menu-diorama.blend')
scene.render.filepath=f'{ROOT}/public/art/interface/command-post.png';bpy.ops.render.render(write_still=True)
print('Menu poster and packed interface references saved.')
