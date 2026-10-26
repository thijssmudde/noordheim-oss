"""Render map cards from the actual terrain samples and exported Skerry-family GLBs.

First run node scripts/export-biome-scenes.mjs. No generated illustration is used.
Optional arguments after --: map ID and preview (960px), otherwise three final 1920px cards.
"""
import bpy, json, math, sys
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
args=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
ids=[args[0]] if args and args[0] != 'all' else ['frostgate','amberfen','cinderreach']
preview='preview' in args

def rgb(h):
    h=h.lstrip('#')
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in [int(h[i:i+2],16)/255 for i in (0,2,4)])

def noise(x,z):
    def hash(a,b):return (math.sin(a*127.1+b*311.7)*43758.5453)%1
    i,j=math.floor(x),math.floor(z);u,v=x-i,z-j;u=u*u*(3-2*u);v=v*v*(3-2*v)
    return ((1-u)*hash(i,j)+u*hash(i+1,j))*(1-v)+((1-u)*hash(i,j+1)+u*hash(i+1,j+1))*v

def smooth(a,b,x):
    t=max(0,min(1,(x-a)/(b-a)))
    return t*t*(3-2*t)

for map_id in ids:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    data=json.loads((ROOT/'outputs/biome-review'/f'{map_id}.json').read_text())
    palette=data['biome']['surface'];scene=bpy.context.scene;link=bpy.context.collection.objects.link
    scene.world=bpy.data.worlds.new('Northern daylight');scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=rgb('#b3c4b6')+(1,)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.7
    verts=[v[:3] for v in data['vertices']];faces=[];cols=data['columns']
    for j in range(data['rows']-1):
        for i in range(cols-1):
            a=j*cols+i;faces.append((a,a+cols,a+cols+1,a+1))
    geo=bpy.data.meshes.new('Playable terrain');geo.from_pydata(verts,[],faces);geo.update();geo.shade_smooth()
    ground=bpy.data.objects.new('Playable terrain',geo);link(ground)
    colors=geo.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='POINT')
    for index,(x,y,h,kind) in enumerate(data['vertices']):
        z=-y;broad=noise(x*.075,z*.075);detail=noise(x*2.7,z*2.7);clumps=noise(x*.47,z*.47)
        base=palette['rock'] if kind in ('cliff','ramp') else palette['shore'] if kind in ('bank','shore','ford') else palette['marsh'] if kind=='marsh' else palette['water'] if kind in ('river','brook','lake','sea') else palette['heath']
        col=Vector(rgb(base))
        if kind=='void' and map_id!='amberfen':
            col=Vector(rgb(palette['rock']))
            if map_id=='frostgate':col=col.lerp(Vector(rgb(palette['snow'])),smooth(4,18,h))
        if kind in ('land','plateau'):
            snow=smooth(.645,.657,broad*.78+clumps*.20+detail*.02+palette['snowCover'])
            col=Vector(rgb(palette['earth'])).lerp(Vector(rgb(palette['heath'])),smooth(.1,.9,broad))
            stone=smooth(.58,.73,noise(x*.16+73,z*.16+73))*(1-snow)
            col=col.lerp(Vector(rgb(palette['rock'])),stone).lerp(Vector(rgb(palette['snow'])),snow)
            cx,cz=data['center']['x'],data['center']['z']
            yard=1-smooth(12,22,max(abs(x-cx)*.85,abs(z-cz)))
            col=col.lerp(Vector(rgb(palette['gravel'])),yard*.88)
        col*=.9+detail*.14
        colors.data[index].color=(*col,1)
    mat=bpy.data.materials.new('Game ground palette');mat.use_nodes=True
    vc=mat.node_tree.nodes.new('ShaderNodeVertexColor');vc.layer_name='Col'
    bsdf=mat.node_tree.nodes['Principled BSDF'];mat.node_tree.links.new(vc.outputs['Color'],bsdf.inputs['Base Color']);bsdf.inputs['Roughness'].default_value=.94
    tex=mat.node_tree.nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=4
    coords=mat.node_tree.nodes.new('ShaderNodeNewGeometry');mat.node_tree.links.new(coords.outputs['Position'],tex.inputs['Vector'])
    bump=mat.node_tree.nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.16;bump.inputs['Distance'].default_value=.055
    mat.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);mat.node_tree.links.new(bump.outputs['Normal'],bsdf.inputs['Normal']);geo.materials.append(mat)
    bpy.ops.mesh.primitive_plane_add(size=600,location=(0,0,-.16));water=bpy.context.object
    wm=bpy.data.materials.new('Northern water');wm.use_nodes=True
    w=wm.node_tree.nodes['Principled BSDF'];w.inputs['Base Color'].default_value=rgb(palette['water'])+(1,);w.inputs['Roughness'].default_value=.3;w.inputs['Metallic'].default_value=.15
    water.data.materials.append(wm)
    wn=wm.node_tree.nodes;wl=wm.node_tree.links
    tex=wn.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=1.5;tex.inputs['Detail'].default_value=2
    position=wn.new('ShaderNodeNewGeometry');wl.new(position.outputs['Position'],tex.inputs['Vector'])
    bump=wn.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.22;bump.inputs['Distance'].default_value=.055
    wl.new(tex.outputs['Fac'],bump.inputs['Height']);wl.new(bump.outputs['Normal'],w.inputs['Normal'])
    library={}
    def place(folder,name,x,z,y,scale=1,angle=0,stretch=None):
        key=(folder,name)
        if key not in library:
            before=set(bpy.data.objects)
            bpy.ops.import_scene.gltf(filepath=str(ROOT/'public/models'/folder/(name+'.glb')))
            added=set(bpy.data.objects)-before
            for obj in added:obj.hide_render=True
            library[key]=added
        added=library[key];copies={}
        for obj in added:
            c=obj.copy();c.hide_render=False;link(c);copies[obj]=c
        root=bpy.data.objects.new(name,None);link(root)
        for obj,c in copies.items():c.parent=copies.get(obj.parent,root)
        root.location=(x,-z,y);root.rotation_euler.z=angle
        root.scale=stretch if stretch else (scale,scale,scale)
    for p in data['placements']:place('landscape',**p)
    for p in data['structures']:place(**p)
    for b in data['bridges']:place('landscape','bridge_span',b['x'],b['z'],.045,stretch=(1,b['length']/16,1))
    for pool in data['pools']:
        bpy.ops.mesh.primitive_circle_add(vertices=48,radius=1,fill_type='NGON',location=(pool['x'],-pool['z'],-.145))
        obj=bpy.context.object;obj.scale=(pool['rx'],pool['rz'],1)
        m=bpy.data.materials.new('Geothermal water');m.diffuse_color=rgb('#88bbb0')+(1,);obj.data.materials.append(m)
    focus=data['focus'];fx,fz=focus['x'],focus['z']
    cx,cz,ch=data['center']['x'],data['center']['z'],data['center']['y']
    target=Vector((cx+2,-cz+12,ch+3))
    bpy.ops.object.camera_add(location=(cx-27,-cz-39,ch+20));cam=bpy.context.object;scene.camera=cam
    cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.lens=32;cam.data.sensor_width=36
    bpy.ops.object.light_add(type='SUN',location=(-40,-60,90));sun=bpy.context.object;sun.data.energy=2.4;sun.data.angle=.12
    sun.rotation_euler=(Vector((0,0,0))-sun.location).to_track_quat('-Z','Y').to_euler();sun.data.color=rgb('#fff1d9')
    scene.render.engine='CYCLES';scene.cycles.samples=24 if preview else 64;scene.cycles.use_denoising=True
    try:
        prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='METAL';prefs.get_devices()
        for device in prefs.devices:device.use=True
        scene.cycles.device='GPU'
    except Exception:pass
    scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast';scene.view_settings.exposure=.3
    scene.render.resolution_x=960 if preview else 1920;scene.render.resolution_y=540 if preview else 1080;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    out=ROOT/'outputs/biome-review'/f'{map_id}-{"preview" if preview else "field-v3"}.png'
    scene.render.filepath=str(out)
    bpy.ops.render.render(write_still=True)
    print('Rendered',str(out))
