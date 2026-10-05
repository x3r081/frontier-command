"""Encode rendered campaign PNGs as optimized WebP delivery assets."""
import argparse
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / 'public' / 'assets'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--remove-png', action='store_true', help='remove validated PNG intermediates after encoding')
    args = parser.parse_args()
    sources = sorted(ASSET_DIR.glob('campaign-*.png'))
    if not sources:
        raise SystemExit('No campaign PNG renders found.')
    for source in sources:
        target = source.with_suffix('.webp')
        with Image.open(source) as image:
            rgb = image.convert('RGB')
            rgb.save(target, 'WEBP', quality=91, method=6)
            dimensions = rgb.size
        with Image.open(target) as check:
            if check.size != dimensions or check.format != 'WEBP':
                target.unlink(missing_ok=True)
                raise RuntimeError(f'WebP validation failed for {source.name}')
        print(f'{target.name}: {dimensions[0]}x{dimensions[1]}, {target.stat().st_size:,} bytes')
        if args.remove_png:
            source.unlink()


if __name__ == '__main__':
    main()
