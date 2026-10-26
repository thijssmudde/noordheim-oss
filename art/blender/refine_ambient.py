"""Finish original ambient assets without changing bounds or articulation.
blender -b --python art/blender/refine_ambient.py -- --source . --output .dream-loop/ambient
"""
import bpy, argparse, sys, math, json, struct
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);a.output.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(a.source.resolve()/'art/environment.blend'))
responses={'feathers':(.88,0),'wingtip':(.95,0),'beak':(.63,0),'cloth':(.94,0),'boots':(.85,0),'orange':(.87,0),'reflective':(.48,.08),'skin':(.81,0),'stone':(.94,0),'lichen':(.98,0),'grass':(.92,0),'heather':(.96,0)}
factors={}
for m in bpy.data.materials:
 if not m.use_nodes:continue
 bs=m.node_tree.nodes.get('Principled BSDF')
 if not bs:continue
 rough,metal=responses.get(m.name.split('.')[0],(.88,0))
 bs.inputs['Roughness'].default_value=rough;bs.inputs['Metallic'].default_value=metal
 original=tuple(bs.inputs['Base Color'].default_value);factors[m.name]=original
 attr=m.node_tree.nodes.new('ShaderNodeVertexColor');attr.layer_name='AmbientFinish'
 mix=m.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[1].default_value=original
 m.node_tree.links.new(attr.outputs['Color'],mix.inputs[2]);m.node_tree.links.new(mix.outputs[0],bs.inputs['Base Color'])
for rootname in ['gull','technician','shore_patch']:
 root=bpy.data.objects[rootname]
 for o in root.children_recursive:
  if o.type!='MESH':continue
  colors=o.data.color_attributes.new(name='AmbientFinish',type='BYTE_COLOR',domain='POINT')
  zs=[v.co.z for v in o.data.vertices];lo=min(zs);span=max(.01,max(zs)-lo)
  for v,c in zip(o.data.vertices,colors.data):
   z=(v.co.z-lo)/span
   grain=math.sin(v.co.x*23+v.co.y*17+v.co.z*13)*math.sin(v.co.z*31+v.co.x*9)
   # Lower creases, boots and undersides carry quiet wear; caps remain clean.
   factor=.86+.10*z+.025*grain
   if rootname=='gull':factor=.94+.05*z
   c.color=(factor,factor,factor,1)
  o['finish']='original ambient material and vertex surface pass'
 bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
 for child in root.children_recursive:child.select_set(True)
 bpy.ops.export_scene.gltf(filepath=str(a.output/(rootname+'.glb')),export_format='GLB',use_selection=True,export_yup=True,export_extras=True)
 # glTF exports vertex modulation, but not the constant Multiply input. Preserve
 # the original linear albedo explicitly in the exported material factor.
 path=a.output/(rootname+'.glb');data=path.read_bytes();length=struct.unpack_from('<I',data,12)[0]
 doc=json.loads(data[20:20+length])
 for mat in doc['materials']:
  mat.setdefault('pbrMetallicRoughness',{})['baseColorFactor']=factors[mat['name']]
 encoded=json.dumps(doc,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4);tail=data[20+length:]
 path.write_bytes(struct.pack('<III',0x46546c67,2,20+len(encoded)+len(tail))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+tail)
bpy.ops.wm.save_as_mainfile(filepath=str(a.output/'ambient-finish.blend'))
