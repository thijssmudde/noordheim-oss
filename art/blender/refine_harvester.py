"""Regenerate only the repaired Malm, its editable source and its portrait."""
from pathlib import Path

# Reuse the equipment authoring helpers without rebuilding the other eighteen models.
script=Path(__file__).with_name('create_tactical.py')
source=script.read_text().split('tank();lynx();ranger();')[0]
exec(compile(source,str(script),'exec'),globals())
harvester()
for obj in list(root.children_recursive):
    if obj.type!='MESH':continue
    bpy.context.view_layer.objects.active=obj
    for modifier in list(obj.modifiers):bpy.ops.object.modifier_apply(modifier=modifier.name)
for material in M.values():
    group=[o for o in root.children if o.type=='MESH' and material in list(o.data.materials)]
    if len(group)<2:continue
    bpy.ops.object.select_all(action='DESELECT')
    for obj in group:obj.select_set(True)
    bpy.context.view_layer.objects.active=group[0];bpy.ops.object.join()
    group[0].name='harvester_'+material.name
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/harvester.blend'))
bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
for obj in root.children_recursive:obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'harvester.glb'),export_format='GLB',
    use_selection=True,export_extras=True,export_yup=True,export_all_vertex_colors=True,export_texcoords=False)

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=32
scene.render.resolution_x=256;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
scene.world.color=(.35,.35,.35)
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
target=Vector((0,0,1.2));camera.location=target+Vector((6,-8.1,5.7))
camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=8.1
for p,energy,size in [((5,-7,10),1600,7),((-6,-1,6),1000,6)]:
    bpy.ops.object.light_add(type='AREA',location=p);light=bpy.context.object
    light.data.energy=energy;light.data.shape='DISK';light.data.size=size
    light.rotation_euler=(target-light.location).to_track_quat('-Z','Y').to_euler()
scene.render.filepath=str(ICONS/'harvester.png');bpy.ops.render.render(write_still=True)
print('Malm repaired: open hopper, exterior ribs, and named ironstone cargo mesh.')
