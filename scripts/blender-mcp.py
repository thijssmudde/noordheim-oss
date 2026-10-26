"""Use the installed Blender MCP server to author Noordheim assets in an open Blender.

uv run --python 3.11 --with mcp python scripts/blender-mcp.py status
uv run --python 3.11 --with mcp python scripts/blender-mcp.py concept
uv run --python 3.11 --with mcp python scripts/blender-mcp.py architecture
uv run --python 3.11 --with mcp python scripts/blender-mcp.py landscape
uv run --python 3.11 --with mcp python scripts/blender-mcp.py factions
"""
import asyncio
import os
from pathlib import Path
import shutil
import sys
import tempfile
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT=Path(__file__).resolve().parents[1]
USER_PROMPT='Connect to Blender MCP. Paste in the concept for the game. Use the Codex image gen skill to generate concept images of the target art style, then iterate until in-game screenshots look as close as possible to those, at 60fps. We also want to focus on 3D, so we should allow rotation.'

def source(action):
 if action=='concept':
  prompt=(ROOT/'art/concepts/prompts.md').read_text()
  return "import bpy\nbpy.context.scene['NOORDHEIM_CONCEPT']="+repr(prompt)+"\n"+'\n'.join("image=bpy.data.images.load("+repr(str(ROOT/'art/concepts'/name))+",check_existing=True)\nimage.pack()" for name in ['noordheim-atmosphere.png','noordheim-gameplay.png'])+"\nbpy.ops.wm.save_as_mainfile(filepath="+repr(str(ROOT/'art/art-direction.blend'))+")\nprint('Game concept and both packed references saved.')"
 if action not in ['landscape','architecture','menu','factions']:
  raise ValueError('Choose status, concept, landscape, architecture, menu or factions.')
 s=(ROOT/f'art/blender/create_{action}.py').read_text()
 # Resolve local paths before sending code. Blender safe mode only receives
 # ordinary modeling operators, numeric geometry and literal export filenames.
 s=s.replace('from pathlib import Path\n','')
 s=s.replace('ROOT = Path(__file__).resolve().parents[2]', 'ROOT = '+repr(str(ROOT)))
 for folder in ['landscape','tactical']:
  s=s.replace("OUT = ROOT / 'public/models/"+folder+"'", "OUT = ROOT + '/public/models/"+folder+"'")
 s=s.replace('OUT.mkdir(parents=True, exist_ok=True)\n','')
 s=s.replace("str(ROOT/'art/"+action+".blend')", "ROOT+'/art/"+action+".blend'")
 s=s.replace("str(OUT/(root.name+'.glb'))", "OUT+'/'+root.name+'.glb'")
 s=s.replace("str(ROOT/'public/art/tactical'/(root.name+'.png'))", "ROOT+'/public/art/tactical/'+root.name+'.png'")
 return s

async def main():
 action=sys.argv[1] if len(sys.argv)>1 else 'status'
 env=dict(os.environ,BLENDER_MCP_SAFE_MODE='1',BLENDER_MCP_DISABLE_TELEMETRY='1',BLENDER_HOST='127.0.0.1')
 params=StdioServerParameters(command=shutil.which('uvx') or str(Path.home()/'.local/bin/uvx'),args=['--python','3.11','blender-mcp'],env=env)
 with tempfile.TemporaryFile(mode='w+') as log:
  async with stdio_client(params,errlog=log) as (read,write):
   async with ClientSession(read,write) as session:
    await session.initialize()
    if action=='status':
     result=await session.call_tool('get_addon_status',{'user_prompt':USER_PROMPT})
    else:
     result=await session.call_tool('execute_blender_code',{'code':source(action),'user_prompt':USER_PROMPT},read_timeout_seconds=900)
    output='\n'.join(c.text for c in result.content if c.type=='text')
    print(output)
    if result.is_error or output.startswith(('Rejected','Error')):raise RuntimeError('Blender MCP action failed.')

asyncio.run(main())
