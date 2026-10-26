"""Keep full-resolution rendered masters and encode lightweight homepage assets."""
from pathlib import Path
from shutil import copyfile
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
for name in ['frostgate', 'amberfen', 'cinderreach']:
    source = ROOT / 'outputs/biome-review' / f'{name}-field-v3.png'
    target = ROOT / 'public/art/maps'
    target.mkdir(parents=True, exist_ok=True)
    copyfile(source, target / source.name)
    with Image.open(source) as image:
        image.save(target / f'{name}-field-v3.webp', quality=91, method=6)
        image.resize((640, 360), Image.Resampling.LANCZOS).save(
            target / f'{name}-field-card-v3.webp', quality=88, method=6)
    print(f'Encoded {name}: 1920px master and 640px card')
