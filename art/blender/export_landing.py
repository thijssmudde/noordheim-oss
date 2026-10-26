"""Export edited art-pass sources without regenerating or saving over any .blend."""
import bpy
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
for source, folder, names in [
    ('biomes.blend','landscape',('glacial_spires','glacial_scree','birch_amber','birch_russet','fen_reeds','basalt_columns','basalt_scree','granite_dry_1','granite_dry_2','spruce_dry','juniper_dry')),
    ('landscape.blend','landscape',('spruce_coastal','spruce_windswept','spruce_young',
        'granite_1','granite_2','juniper','field_stores','field_fence','bridge_span')),
    # Buildings now come from diorama-buildings.blend (DIORAMA_EXPORT=1 diorama_buildings.py).
    ('landing-equipment.blend','tactical',('lynx',)),
    ('ore.blend','ore',('ironstone_1','ironstone_2','ironstone_3')),
    ('harvester.blend','tactical',('harvester',)),
    ('factions.blend','tactical',('raider','sapper','militia','marksman','snowmobile','mortar','bulwark','fenrir')),
]:
    bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art'/source))
    if folder=='tactical':
        # Blender previews multiply the baked vertex colours by the paint. glTF
        # supplies that multiplication natively, so export the constant paint factor.
        for material in bpy.data.materials:
            if not material.use_nodes:continue
            bsdf=material.node_tree.nodes.get('Principled BSDF')
            if not bsdf:continue
            for link in list(bsdf.inputs['Base Color'].links):
                mix=link.from_node
                if mix.type != 'MIX_RGB' or mix.blend_type != 'MULTIPLY':continue
                colour_links=list(mix.inputs[2].links)
                if not colour_links or colour_links[0].from_node.type != 'VERTEX_COLOR':continue
                if colour_links[0].from_node.layer_name != 'Surface':continue
                paint=tuple(mix.inputs[1].default_value)
                material.node_tree.links.remove(link)
                bsdf.inputs['Base Color'].default_value=paint
    for name in names:
        root=bpy.data.objects[name]
        bpy.ops.object.select_all(action='DESELECT');root.select_set(True)
        for child in root.children_recursive:child.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models'/folder/(name+'.glb')),
            export_format='GLB',use_selection=True,export_yup=True,export_extras=True,
            export_all_vertex_colors=True,export_texcoords=False)
print('Exported edited Blender sources; source files were not overwritten.')
