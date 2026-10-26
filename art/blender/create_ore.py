"""Iron-bearing outcrops for Skerry: dark fractured stone and warm oxidised seams."""
import bpy
import math
import random
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'public/models/ore'
OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
rng=random.Random(1207)
def linear(v):return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
def rgb(h):return tuple(linear(int(h[i:i+2],16)/255) for i in (0,2,4))
stone=rgb('66685f');iron=rgb('af8050');cut=rgb('c8aa73');dark=rgb('4b504c')
mat=bpy.data.materials.new('Ironstone');mat.use_nodes=True
bsdf=mat.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value=.82;bsdf.inputs['Metallic'].default_value=.18
colour=mat.node_tree.nodes.new('ShaderNodeVertexColor');colour.layer_name='Mineral'
mat.node_tree.links.new(colour.outputs['Color'],bsdf.inputs['Base Color'])
roots=[]
for variant in range(3):
    root=bpy.data.objects.new('ironstone_'+str(variant+1),None)
    bpy.context.collection.objects.link(root);root['ore_art']=True;roots.append(root)
    for part in range(3):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2,radius=1,
            location=((part-1)*.39,rng.uniform(-.18,.18),.24))
        obj=bpy.context.object;obj.parent=root;obj.name='Fractured ironstone'
        for v in obj.data.vertices:
            v.co.x*=rng.uniform(.82,1.1)
            v.co.y*=rng.uniform(.75,1.1)
            v.co.z=max(-.43, min(.82,v.co.z*.64+rng.uniform(-.06,.06)))
        obj.scale=(.7 if part==1 else .5, .6, .9 if part==1 else .62)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        obj.data.update();obj.data.materials.append(mat)
        attr=obj.data.color_attributes.new(name='Mineral',type='BYTE_COLOR',domain='CORNER')
        for polygon in obj.data.polygons:
            p=polygon.center
            vein=math.sin(p.z*16+p.x*5+p.y*3+variant)
            shade=cut if vein>.87 else iron if vein>.1 else stone if polygon.normal.z>.05 else dark
            grain=rng.uniform(.83,1.10)
            for i in polygon.loop_indices:attr.data[i].color=tuple(c*grain for c in shade)+(1,)
    # Small angular fragments collect at the base of each outcrop.
    for i in range(6):
        a=rng.random()*math.tau
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1,radius=.14,
            location=(math.cos(a)*rng.uniform(.55,.95),math.sin(a)*rng.uniform(.35,.65),.08))
        obj=bpy.context.object;obj.parent=root;obj.scale=(1.3,.9,.6)
        obj.data.materials.append(mat)
        attr=obj.data.color_attributes.new(name='Mineral',type='BYTE_COLOR',domain='CORNER')
        for datum in attr.data:datum.color=(iron if i%3==0 else stone)+(1,)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in root.children:obj.select_set(True)
    bpy.context.view_layer.objects.active=root.children[0]
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    bpy.ops.object.join();obj=bpy.context.object;obj.name=root.name+'_mesh'
    obj.data.materials.clear();obj.data.materials.append(mat)
    for polygon in obj.data.polygons:polygon.material_index=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/ore.blend'))
for root in roots:
    bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
    for obj in root.children_recursive:obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT/(root.name+'.glb')),export_format='GLB',
        use_selection=True,export_yup=True,export_extras=True,export_all_vertex_colors=True,export_texcoords=False)
print('Three original ironstone outcrops exported.')
