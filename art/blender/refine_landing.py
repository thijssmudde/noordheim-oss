"""Refine HQ and Lynx from the original source, preserving the rest of the library.

Cycles bakes contact occlusion to vertex colours. Surface wear is stored in the
same colours, so the browser does not need Blender's procedural shader nodes.
The result remains editable in landing-equipment.blend.
"""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector
from mathutils.noise import noise_vector

ROOT = Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/tactical.blend'))
roots = [bpy.data.objects[name] for name in ('hq', 'lynx')]
keep = {o for r in roots for o in [r, *r.children_recursive]}
for obj in list(bpy.data.objects):
    if obj not in keep:
        bpy.data.objects.remove(obj, do_unlink=True)
rng = random.Random(724)

def box(root, name, p, size, mat, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p)
    obj=bpy.context.object; obj.name=name; obj.parent=root; obj.scale=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(bpy.data.materials[mat])
    if bevel:
        mod=obj.modifiers.new('Weathered edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return obj

hq, lynx = roots
# Both ends are authored: the RTS camera usually sees the rear of a north-facing HQ.
for side in [-1,1]:
    y=side*2.515
    data=bpy.data.meshes.new('Timber gable')
    data.from_pydata([(-2.7,y,3.04),(2.7,y,3.04),(0,y,4.43)],[],[(0,1,2),(2,1,0)])
    data.update()
    obj=bpy.data.objects.new('Timber gable',data);bpy.context.collection.objects.link(obj)
    obj.parent=hq;data.materials.append(bpy.data.materials['red'])
box(hq,'Rear dispatch door',(0,2.54,1.4),(1.3,.07,2.15),'dark')
box(hq,'Rear lintel',(0,2.61,2.51),(1.56,.13,.12),'snow')
for x in [-.73,.73]:
    box(hq,'Door jamb',(x,2.61,1.39),(.10,.13,2.22),'snow')
for x in [-1.83,1.83]:
    box(hq,'Rear window frame',(x,2.56,2.0),(1.05,.12,.94),'snow')
    box(hq,'Rear glazing',(x,2.64,2.0),(.87,.05,.76),'glass')
    box(hq,'Window mullion',(x,2.68,2.0),(.045,.05,.8),'steel',.005)
    box(hq,'Window sill',(x,2.64,1.49),(1.12,.25,.10),'snow')
for i in range(19):
    x=-2.6+i*.29
    if abs(x) < .82 or 1.27 < abs(x) < 2.42:continue
    box(hq,'Rear weatherboard seam',(x,2.52,1.67),(.025,.025,2.62),'wood',0)
box(hq,'Gable vent',(0,2.55,3.68),(.64,.1,.42),'dark')
for z in [3.55,3.66,3.77]:
    box(hq,'Vent louvre',(0,2.62,z),(.67,.075,.045),'steel',.005)
box(hq,'Entry stone',(0,-3.15,.18),(2.3,1.05,.2),'concrete')
box(hq,'Upper step',(0,-2.92,.32),(1.8,.6,.18),'concrete')
for x in [-2.84,2.84]:
    box(hq,'Rain gutter',(x,0,3.04),(.14,5.55,.13),'dark')
    box(hq,'Downpipe',(x,2.35,1.64),(.09,.10,2.65),'steel')
    box(hq,'Snow guard',(x*.8,0,3.38),(.055,5.4,.08),'dark',.008)
box(hq,'Entrance canopy',(0,-2.92,2.76),(2.05,.8,.13),'steel')
for x in [-.88,.88]:
    box(hq,'Canopy bracket',(x,-2.64,2.5),(.07,.22,.48),'dark',.008)
box(hq,'Dispatch cabinet',(3.0,.95,.78),(.55,1.0,1.0),'armor')
box(hq,'Cabinet label',(3.285,.95,.88),(.02,.5,.16),'snow',0)

for side in [-1,1]:
    box(lynx,'Door inset',(side*.916,-.18,1.55),(.025,.73,.75),'armor')
    box(lynx,'Door handle',(side*.95,-.06,1.8),(.06,.23,.045),'steel',.01)
    box(lynx,'Running board',(side*1.11,-.12,.92),(.23,2.5,.08),'dark')
    box(lynx,'Stowed recovery board',(side*.66,1.34,2.12),(.45,.6,.08),'wood')
    for y in [-1.22,0,1.22]:
        box(lynx,'Mudflap',(side*1.08,y+.43,.46),(.46,.06,.54),'rubber',.008)
box(lynx,'Roof equipment rack',(0,.86,2.16),(1.5,.9,.09),'dark')
box(lynx,'Winter tarpaulin',(0,.96,2.32),(1.3,.63,.27),'armor',.1)
for x in [-.46,.46]:
    box(lynx,'Cargo webbing',(x,.96,2.32),(.055,.66,.29),'dark',.008)

scene = bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=16
scene.render.bake.target='VERTEX_COLORS'
scene.world.color=(.15,.15,.15)
# Vertex-colour AO needs enough samples along otherwise large wall/roof faces.
for root in roots:
    for o in root.children_recursive:
        if o.type != 'MESH': continue
        bpy.context.view_layer.objects.active=o
        if root == hq and o.data.materials[0].name in ('red', 'concrete') and len(o.data.polygons) < 600:
            mod=o.modifiers.new('Surface samples','SUBSURF'); mod.subdivision_type='SIMPLE'; mod.levels=1
            bpy.ops.object.modifier_apply(modifier=mod.name)
        col=o.data.color_attributes.new(name='Surface',type='BYTE_COLOR',domain='CORNER')
        o.data.color_attributes.active_color=col
        for datum in col.data: datum.color=(1,1,1,1)

for root in roots:
    for other in roots:
        for o in other.children_recursive: o.hide_render=other != root
    for obj in root.children_recursive:
        if obj.type != 'MESH': continue
        bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True)
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.bake(type='AO')
        col=obj.data.color_attributes['Surface']
        mat=obj.data.materials[0]
        paint=mat.name=='culture_trim'
        for poly in obj.data.polygons:
            for index in poly.loop_indices:
                vertex=obj.data.vertices[obj.data.loops[index].vertex_index]
                p=obj.matrix_world @ vertex.co
                n=noise_vector(Vector((p.x*4,p.y*4,p.z*1.7))).x
                grain=noise_vector(p*29).x
                ao=max(.38,min(1,col.data[index].color[0]))
                if paint:
                    tint=(ao*.35+.65,)*3
                else:
                    weather=.90+n*.09+grain*.025
                    base=(.55+ao*.45)*weather
                    # Road dust settles below the wheel arches; timber darkens at its foot.
                    dirt=max(0,1-p.z/1.5)*(.2 if root==lynx else .12)
                    tint=(base,base*(1-dirt*.16),base*(1-dirt*.33))
                col.data[index].color=(*tint,1)
        # Blender material and the glTF exporter both consume this named colour layer.
        obj.data.materials[0]=mat.copy()
        local=obj.data.materials[0]
        local.name='culture_trim' if paint else mat.name+'_weathered'
        nodes=local.node_tree.nodes
        attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='Surface'
        mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
        mix.inputs[1].default_value=mat.diffuse_color
        local.node_tree.links.new(attr.outputs['Color'],mix.inputs[2])
        local.node_tree.links.new(mix.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])

# Join new detail by the original material family, keeping culture paint separate.
for root in roots:
    groups={}
    for obj in list(root.children):
        if obj.type=='MESH':
            family=obj.data.materials[0].name.split('.')[0]
            groups.setdefault(family,[]).append(obj)
    for family,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        canonical=bpy.data.materials['culture_trim'] if family=='culture_trim' else objects[0].data.materials[0]
        # Use original material factors in GLB; vertex colours supply the baked detail.
        canonical.name=family
        bsdf=canonical.node_tree.nodes.get('Principled BSDF')
        for link in list(canonical.node_tree.links): canonical.node_tree.links.remove(link)
        canonical.node_tree.links.new(bsdf.outputs['BSDF'],canonical.node_tree.nodes.get('Material Output').inputs['Surface'])
        bsdf.inputs['Base Color'].default_value=canonical.diffuse_color
        for obj in objects:
            obj.data.materials.clear();obj.data.materials.append(canonical);obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        obj=bpy.context.object
        obj.data.materials.clear();obj.data.materials.append(canonical)
        for p in obj.data.polygons:p.material_index=0
        # Restore vertex-colour shading for Blender without a multiply node exporter ambiguity.
        # glTF exports active vertex colours and multiplies them with the material factor.

for root in roots:
    for o in root.children_recursive:o.hide_render=False
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/landing-equipment.blend'))
for root in roots:
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for o in root.children_recursive:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/tactical'/(root.name+'.glb')),
        export_format='GLB',use_selection=True,export_extras=True,export_yup=True,
        export_all_vertex_colors=True,export_texcoords=False)

# Render the same asset and its baked surface colours for the production UI.
for root in roots:
    for obj in root.children_recursive:
        if obj.type!='MESH':continue
        mat=obj.data.materials[0];nodes=mat.node_tree.nodes
        attr=nodes.new('ShaderNodeVertexColor');attr.layer_name='Surface'
        mix=nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
        mix.inputs[1].default_value=mat.diffuse_color
        mat.node_tree.links.new(attr.outputs['Color'],mix.inputs[2])
        mat.node_tree.links.new(mix.outputs[0],nodes.get('Principled BSDF').inputs['Base Color'])
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/landing-equipment.blend'))
scene.render.resolution_x=256;scene.render.resolution_y=192;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.film_transparent=True
bpy.ops.object.camera_add();camera=bpy.context.object;scene.camera=camera;camera.data.type='ORTHO'
for p,energy,size in [((5,-7,10),1600,7),((-6,-1,6),700,6)]:
    bpy.ops.object.light_add(type='AREA',location=p);o=bpy.context.object;o.data.energy=energy;o.data.size=size
    o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
for root in roots:
    for other in roots:
        for o in other.children_recursive:o.hide_render=other!=root
    size=9 if root==hq else 5
    target=Vector((0,0,2.6 if root==hq else 1))
    camera.location=target+Vector((size,-size*1.35,size*.95))
    camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=size*1.35
    scene.render.filepath=str(ROOT/'public/art/tactical'/(root.name+'.png'))
    bpy.ops.render.render(write_still=True)
print('HQ and Lynx: refined, baked, exported and rendered.')
