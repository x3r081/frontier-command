"""Generate the original vector sprites used by the RTS canvas.

Run with: python3 scripts/generate_assets.py
All sprites have a transparent 128 x 128 viewBox and face north.
"""

from pathlib import Path


OUT = Path(__file__).resolve().parents[1] / "public" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

DEFS = """
<defs>
  <linearGradient id="roof" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#a6b9bf"/><stop offset=".48" stop-color="#5a7882"/><stop offset="1" stop-color="#253f4c"/></linearGradient>
  <linearGradient id="roofDark" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#697e88"/><stop offset="1" stop-color="#213842"/></linearGradient>
  <linearGradient id="left" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#365663"/><stop offset="1" stop-color="#172a34"/></linearGradient>
  <linearGradient id="right" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#2b4754"/><stop offset="1" stop-color="#0d222d"/></linearGradient>
  <linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9e5e3"/><stop offset=".43" stop-color="#819aa2"/><stop offset="1" stop-color="#354e5a"/></linearGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#95adb6"/><stop offset=".45" stop-color="#52707e"/><stop offset="1" stop-color="#263f4c"/></linearGradient>
  <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#b7faff"/><stop offset=".32" stop-color="#58d5de"/><stop offset="1" stop-color="#127789"/></linearGradient>
  <linearGradient id="cyan" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#bdfaff"/><stop offset=".5" stop-color="#49dce4"/><stop offset="1" stop-color="#1798b0"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffe8a1"/><stop offset=".45" stop-color="#f4b85a"/><stop offset="1" stop-color="#ba6e28"/></linearGradient>
  <linearGradient id="ore" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff0b6"/><stop offset=".48" stop-color="#f6b753"/><stop offset="1" stop-color="#98522e"/></linearGradient>
  <radialGradient id="glow"><stop stop-color="#8ff7fb" stop-opacity=".74"/><stop offset="1" stop-color="#39bfd0" stop-opacity="0"/></radialGradient>
  <filter id="blur"><feGaussianBlur stdDeviation="3"/></filter>
  <filter id="softGlow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="roofClip"><path d="M64 24 111 49 64 76 17 49Z"/></clipPath>
</defs>
"""


def svg(body: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" fill="none" stroke-linejoin="round" stroke-linecap="round" role="img">{DEFS}<g>{body}</g></svg>\n'''


def shadow(cx=64, cy=106, rx=43, ry=11):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#061821" opacity=".48" filter="url(#blur)"/>'


def base(roof="url(#roof)"):
    return shadow() + f'''
      <path d="M17 49 64 76 64 101 17 74Z" fill="url(#left)" stroke="#12242c" stroke-width="2"/>
      <path d="M64 76 111 49 111 74 64 101Z" fill="url(#right)" stroke="#10232c" stroke-width="2"/>
      <path d="M64 24 111 49 64 76 17 49Z" fill="{roof}" stroke="#172c36" stroke-width="2.5"/>
      <path d="m20 53 44 25 44-25" stroke="#7ba7b0" stroke-opacity=".54" stroke-width="1.5"/>
      <path d="M23 68 59 89M69 90l35-21" stroke="#52cbd3" stroke-opacity=".42" stroke-width="2.2"/>
      <path d="M26 59v12m8-8v13m8-8v13m8-8v13M78 87v-13m8 8V69m8 8V64m8 8V59" stroke="#7896a0" stroke-opacity=".42" stroke-width="1.5"/>
      <circle cx="64" cy="95" r="2.5" fill="url(#cyan)" filter="url(#softGlow)"/>
    '''


def beacon(x=64, y=23):
    return f'<circle cx="{x}" cy="{y}" r="3" fill="#d4ffff" filter="url(#softGlow)"/><circle cx="{x}" cy="{y}" r="7" stroke="#56e6ec" stroke-opacity=".42"/>'


def hatch(x, y, w=23, h=12):
    return f'<path d="M{x} {y}l{w//2} {-h//2} {w//2} {h//2} {-w//2} {h//2}Z" fill="url(#roofDark)" stroke="#142b35" stroke-width="1.5"/><path d="M{x+4} {y}l{w//2-4} {-h//2+2} {w//2-4} {h//2-2}" stroke="#b8d4d5" stroke-opacity=".6"/>'


ASSETS = {}

ASSETS["command-yard"] = base() + '''
  <g clip-path="url(#roofClip)"><path d="m18 47 46 26 46-26" stroke="#b6cbd0" stroke-opacity=".6" stroke-width="3"/><path d="M20 48 64 24l44 24" stroke="#3ee2e9" stroke-opacity=".55" stroke-width="2"/></g>
  <path d="M39 38 64 25 89 38v22L64 73 39 60Z" fill="#203c49" stroke="#142b35" stroke-width="2"/>
  <path d="M39 38 64 51v22L39 60Z" fill="url(#left)"/><path d="M64 51 89 38v22L64 73Z" fill="url(#right)"/>
  <path d="M64 13 91 28 64 43 37 28Z" fill="url(#metal)" stroke="#1b3642" stroke-width="2.5"/>
  <path d="M50 28 64 20 78 28 64 36Z" fill="url(#glass)" stroke="#1e6f80" stroke-width="1.5"/>
  <path d="m47 47 10 5v8l-10-5Zm34 0-10 5v8l10-5Z" fill="url(#glass)" opacity=".9"/>
  <path d="M64 13V5" stroke="#b5cdd2" stroke-width="3"/>''' + beacon(64, 7) + '''
  <path d="M30 65 52 78m46-13L76 78" stroke="#55e0e7" stroke-width="2.5" opacity=".75"/>
'''

ASSETS["power-plant"] = base("url(#roofDark)") + '''
  <g clip-path="url(#roofClip)"><path d="M24 49 64 27l40 22-40 22Z" stroke="#8ba5ad" stroke-width="3"/>
  <path d="M50 36 26 49l24 13m28-26 24 13-24 13" stroke="#f4b758" stroke-width="3" opacity=".8"/></g>
  <ellipse cx="47" cy="47" rx="17" ry="12" fill="#102c35" stroke="#b4c9c9" stroke-width="3"/>
  <ellipse cx="81" cy="47" rx="17" ry="12" fill="#102c35" stroke="#b4c9c9" stroke-width="3"/>
  <circle cx="47" cy="47" r="9" fill="url(#cyan)" filter="url(#softGlow)"/><circle cx="81" cy="47" r="9" fill="url(#cyan)" filter="url(#softGlow)"/>
  <path d="m47 39 3 5 6 3-6 2-3 6-3-6-6-2 6-3Zm34 0 3 5 6 3-6 2-3 6-3-6-6-2 6-3Z" fill="#d7ffff" opacity=".88"/>
  <path d="M60 38h8M58 56h12" stroke="#f6c06a" stroke-width="3"/>
  <path d="M31 75v7m8-3v7m50-7v7m8-11v7" stroke="#f8bd5f" stroke-width="2.5"/>
'''

ASSETS["refinery"] = base() + '''
  <g clip-path="url(#roofClip)"><path d="M24 52 62 31l41 22" stroke="#f1bb69" stroke-width="4"/></g>
  <path d="M51 31 65 24 79 31v28L65 67 51 59Z" fill="url(#steel)" stroke="#17333c" stroke-width="2"/>
  <ellipse cx="65" cy="29" rx="14" ry="8" fill="url(#metal)" stroke="#213a45" stroke-width="2"/>
  <ellipse cx="65" cy="29" rx="8" ry="4" fill="#2f5964" stroke="#c3d8d8" stroke-width="1.5"/>
  <path d="M35 49 35 29l9-5v20" fill="url(#metal)" stroke="#243944" stroke-width="2"/>
  <ellipse cx="39.5" cy="26" rx="5" ry="3" fill="#1f3c46" stroke="#a9bec3" stroke-width="1.5"/>
  <path d="M82 45 99 54 84 63 67 54Z" fill="#182e39" stroke="#f8be67" stroke-width="2"/>
  <path d="m80 51 4-12 5 12 6 4-10 4Z" fill="url(#ore)" stroke="#7e542b" stroke-width="1.5"/>
  <path d="m29 75 16 9m54-9-16 9" stroke="#f4bb63" stroke-width="3"/>
'''

ASSETS["barracks"] = base() + '''
  <path d="M32 45 64 28 96 45 64 63Z" fill="url(#roofDark)" stroke="#a7bcc2" stroke-width="2"/>
  <path d="M32 45v15l32 17V63Zm64 0v15L64 77V63Z" fill="#274451" stroke="#132b35" stroke-width="2"/>
  <path d="M38 46 64 32l26 14-26 14Z" fill="url(#metal)" stroke="#28444d" stroke-width="1.5"/>
  <path d="M47 46 64 37l17 9-17 9Z" fill="url(#roofDark)" stroke="#253d47"/>
  <path d="m43 59 14 8v8l-14-8Zm42 0-14 8v8l14-8Z" fill="url(#glass)"/>
  <path d="M47 46h34" stroke="#62e6eb" stroke-width="2.2" opacity=".75"/>
  <path d="m25 52 7 4m64 0 7-4" stroke="#f4bd67" stroke-width="3"/>
'''

ASSETS["war-factory"] = base("url(#roofDark)") + '''
  <path d="M25 50 64 29 103 50 64 71Z" fill="url(#metal)" stroke="#1b3945" stroke-width="2.5"/>
  <path d="M32 49 64 32l32 17-32 17Z" fill="url(#roofDark)" stroke="#8cabb3" stroke-width="1.5"/>
  <path d="M43 45 64 34l21 11-21 12Z" fill="#355765" stroke="#6fcdd2" stroke-width="1.5"/>
  <path d="M48 43 64 35l16 8m-29 6 13-7 13 7" stroke="#9edce0" stroke-opacity=".7" stroke-width="1.7"/>
  <path d="M46 76 64 87 82 76v18L64 104 46 94Z" fill="#0d2631" stroke="#6b9da7" stroke-width="2"/>
  <path d="M52 80 64 87 76 80v10l-12 7-12-7Z" fill="#24606c"/>
  <path d="M57 85v10m7-7v12m7-15v10" stroke="#5ce1e7" stroke-width="2"/>
  <path d="M25 72 40 80m63-8-15 8" stroke="#f4bc68" stroke-width="3"/>
'''

ASSETS["radar"] = base("url(#roofDark)") + '''
  <path d="M49 49 64 41 79 49v18L64 75 49 67Z" fill="url(#metal)" stroke="#1a3540" stroke-width="2"/>
  <path d="M64 53V30" stroke="#d4e5e5" stroke-width="4"/>
  <path d="M31 28q30 37 64-1-14 28-32 31Q45 54 31 28Z" fill="url(#metal)" stroke="#203e49" stroke-width="2.5"/>
  <path d="M35 29q27 29 56-1" stroke="#b4e4e4" stroke-width="2" opacity=".8"/>
  <path d="m38 31 27-16 24 14" stroke="#405b67" stroke-width="2"/>
  <path d="M64 31 73 12" stroke="#d9eeee" stroke-width="2.5"/>''' + beacon(74, 11) + '''
  <path d="M52 65 64 71 76 65" stroke="#59dfe6" stroke-width="2.5"/>
  <circle cx="33" cy="52" r="3" fill="url(#cyan)" filter="url(#softGlow)"/>
'''

ASSETS["turret"] = shadow(64, 102, 37, 10) + '''
  <path d="M25 59 64 38 103 59 64 82Z" fill="url(#roofDark)" stroke="#142d38" stroke-width="3"/>
  <path d="M25 59v20l39 23V82Zm78 0v20l-39 23V82Z" fill="url(#left)" stroke="#142d38" stroke-width="2"/>
  <path d="M34 59 64 43 94 59 64 77Z" fill="url(#metal)" stroke="#193b47" stroke-width="2"/>
  <circle cx="64" cy="59" r="19" fill="#203d49" stroke="#a6bdc4" stroke-width="3"/>
  <path d="M57 55V19h14v36" fill="url(#steel)" stroke="#152c39" stroke-width="2.5"/>
  <path d="M60 17h8v28h-8Z" fill="#294856" stroke="#b5c9c8" stroke-width="1"/>
  <ellipse cx="64" cy="17" rx="7" ry="4" fill="#0b222b" stroke="#b5c9c8" stroke-width="2"/>
  <circle cx="64" cy="59" r="12" fill="url(#steel)" stroke="#1b3845" stroke-width="2"/>
  <path d="M55 57 64 52 73 57 64 64Z" fill="url(#glass)"/>
  <path d="m31 66 11 7m55-7-11 7" stroke="#61dce1" stroke-width="2"/>
'''

ASSETS["silo"] = base("url(#roofDark)") + '''
  <path d="M30 55 64 35 98 55 64 73Z" fill="#283f4c" stroke="#7a9da7" stroke-width="2"/>
  <path d="M42 46v18l12 7V53Zm12 7 12-7v18l-12 7Z" fill="url(#steel)" stroke="#1b3540" stroke-width="1.5"/>
  <ellipse cx="54" cy="47" rx="12" ry="7" fill="url(#metal)" stroke="#173843" stroke-width="2"/>
  <path d="M66 40v22l13 7V47Zm13 7 13-7v22l-13 7Z" fill="url(#steel)" stroke="#1b3540" stroke-width="1.5"/>
  <ellipse cx="79" cy="41" rx="13" ry="8" fill="url(#metal)" stroke="#173843" stroke-width="2"/>
  <ellipse cx="54" cy="47" rx="5" ry="3" fill="url(#gold)"/><ellipse cx="79" cy="41" rx="6" ry="3.5" fill="url(#gold)"/>
  <path d="m36 75 19 10m36-10L72 86" stroke="#f5be66" stroke-width="2.5"/>
'''

def unit_shadow():
    return '<ellipse cx="64" cy="94" rx="37" ry="13" fill="#07161e" opacity=".5" filter="url(#blur)"/>'


ASSETS["tank"] = unit_shadow() + '''
  <path d="M35 31 49 27l7 10v52l-8 11-13-3Z" fill="#172b35" stroke="#819aa4" stroke-width="2"/>
  <path d="M93 31 79 27l-7 10v52l8 11 13-3Z" fill="#172b35" stroke="#819aa4" stroke-width="2"/>
  <path d="M35 39h13m-13 13h13m-13 13h13m-13 13h13m-12 13h12M80 39h13M80 52h13M80 65h13M80 78h13M80 91h12" stroke="#49616c" stroke-width="3"/>
  <path d="M49 33 64 25 79 33 85 85 64 99 43 85Z" fill="url(#steel)" stroke="#162f3b" stroke-width="3"/>
  <path d="M49 37 64 29 79 37l3 17-18 10-18-10Z" fill="url(#roof)" stroke="#a4bac1" stroke-width="1.5"/>
  <path d="M58 56V17h12v39" fill="url(#metal)" stroke="#183744" stroke-width="2"/>
  <ellipse cx="64" cy="17" rx="6" ry="3" fill="#142b35" stroke="#bad1d3" stroke-width="1.5"/>
  <path d="M49 55 64 47 79 55v22L64 86 49 77Z" fill="url(#roofDark)" stroke="#173440" stroke-width="2"/>
  <path d="M54 55 64 49 74 55l-10 6Z" fill="url(#metal)"/>
  <path d="M56 70h16M50 86l14 8 14-8" stroke="#5ce1e6" stroke-width="2.5"/>
  <path d="M52 39h7m10 0h7" stroke="#f5be65" stroke-width="2"/>
'''

ASSETS["artillery"] = unit_shadow() + '''
  <path d="M37 47 49 38l7 8v43l-7 9-12-5Z" fill="#1b323d" stroke="#8ba7ae" stroke-width="2"/>
  <path d="M91 47 79 38l-7 8v43l7 9 12-5Z" fill="#1b323d" stroke="#8ba7ae" stroke-width="2"/>
  <path d="M38 57h12m-12 14h12m-12 14h12m28-28h12M78 71h12M78 85h12" stroke="#526e79" stroke-width="3"/>
  <path d="M49 47 64 39 79 47l4 43-19 12-19-12Z" fill="url(#steel)" stroke="#1b3640" stroke-width="2.5"/>
  <path d="M60 64 56 12h16l-4 52" fill="url(#metal)" stroke="#1a3744" stroke-width="2.2"/>
  <path d="M58 11h12" stroke="#0c2530" stroke-width="5"/>
  <path d="M51 55 64 48 77 55l4 20-17 10-17-10Z" fill="url(#roofDark)" stroke="#284754" stroke-width="2"/>
  <circle cx="64" cy="64" r="8" fill="url(#metal)" stroke="#143543" stroke-width="2"/>
  <path d="m45 90 19 10 19-10" stroke="#f4bf6b" stroke-width="2.5"/>
'''

ASSETS["harvester"] = unit_shadow() + '''
  <path d="M34 40 48 32l5 10v48l-9 9-12-5Z" fill="#1d3641" stroke="#8fa8ac" stroke-width="2"/>
  <path d="M94 40 80 32l-5 10v48l9 9 12-5Z" fill="#1d3641" stroke="#8fa8ac" stroke-width="2"/>
  <path d="M34 50h13m-13 13h13m-13 13h13m-12 12h11m36-38h13M81 63h13M81 76h13M82 88h11" stroke="#607b84" stroke-width="3"/>
  <path d="M48 38 64 30l16 8 6 49-22 15-22-15Z" fill="url(#steel)" stroke="#153440" stroke-width="3"/>
  <path d="M50 42 64 35l14 7 2 22-16 9-16-9Z" fill="url(#roofDark)" stroke="#a4bcc1" stroke-width="2"/>
  <path d="M54 45 64 40l10 5 2 12-12 7-12-7Z" fill="url(#glass)" opacity=".85"/>
  <path d="M42 29 27 17 23 25l20 21m43-17 15-12 4 8-20 21" fill="url(#gold)" stroke="#683e22" stroke-width="2.5"/>
  <path d="m22 25 15-2m69 2-15-2" stroke="#ffe0a0" stroke-width="3"/>
  <path d="M50 82 64 90 78 82" stroke="#f7c674" stroke-width="3"/>
  <path d="M56 83v9m16-9v9" stroke="#efb452" stroke-width="2"/>
'''

ASSETS["scout"] = unit_shadow() + '''
  <circle cx="39" cy="42" r="10" fill="#182f39" stroke="#7894a0" stroke-width="3"/>
  <circle cx="89" cy="42" r="10" fill="#182f39" stroke="#7894a0" stroke-width="3"/>
  <circle cx="39" cy="87" r="11" fill="#182f39" stroke="#7894a0" stroke-width="3"/>
  <circle cx="89" cy="87" r="11" fill="#182f39" stroke="#7894a0" stroke-width="3"/>
  <circle cx="39" cy="42" r="4" fill="#526e78"/><circle cx="89" cy="42" r="4" fill="#526e78"/>
  <circle cx="39" cy="87" r="4" fill="#526e78"/><circle cx="89" cy="87" r="4" fill="#526e78"/>
  <path d="M48 39 64 25 80 39 83 86 64 98 45 86Z" fill="url(#steel)" stroke="#183440" stroke-width="2.5"/>
  <path d="M54 39 64 29 74 39l3 17-13 8-13-8Z" fill="url(#glass)" stroke="#183f4d" stroke-width="2"/>
  <path d="M49 67 64 59 79 67v17l-15 9-15-9Z" fill="url(#roofDark)" stroke="#19343e" stroke-width="2"/>
  <path d="m54 77 10-5 10 5M53 36l11-8 11 8" stroke="#e3f8f4" stroke-opacity=".75" stroke-width="2"/>
  <path d="M46 46h-6m48 0h-6M48 88l16 9 16-9" stroke="#f5c371" stroke-width="2.5"/>
'''

def soldier_body(engineer=False):
    torso = "url(#gold)" if engineer else "url(#steel)"
    insignia = '<path d="M57 66h14m-7-7v14" stroke="#e7ffff" stroke-width="3"/>' if engineer else '<path d="m57 66 7-5 7 5-7 5Z" fill="url(#cyan)"/>'
    equipment = '''<path d="M82 54 94 61 90 69 79 66Z" fill="url(#gold)" stroke="#5a3d25" stroke-width="2"/><path d="M94 61 103 54" stroke="#d9e1d4" stroke-width="3"/>''' if engineer else '''<path d="M75 45 91 32l6 5-17 19Z" fill="url(#metal)" stroke="#1c3845" stroke-width="2"/><path d="m95 36 8-8" stroke="#c8e5e3" stroke-width="3"/>'''
    return unit_shadow() + f'''
      <path d="M46 78 40 99l12 4 10-21m20-4 6 21-12 4-10-21" fill="#263f4a" stroke="#142b35" stroke-width="2"/>
      <path d="M42 98 39 108l14 2 3-9m27-3 6 10-14 2-3-9" fill="#1a303b" stroke="#5e7a85" stroke-width="2"/>
      <path d="M46 46 34 57l5 20 13-4 9-13m21-14 12 11-5 20-13-4-9-13" fill="url(#steel)" stroke="#1a3946" stroke-width="2.5"/>
      <path d="M47 49 64 42 81 49 82 82 64 90 46 82Z" fill="{torso}" stroke="#183943" stroke-width="2.5"/>
      <path d="M49 52 64 46 79 52l-15 9Z" fill="#264753" opacity=".75"/>
      <path d="M54 51V34h20v17" fill="url(#steel)" stroke="#1a3542" stroke-width="2"/>
      <ellipse cx="64" cy="34" rx="17" ry="13" fill="url(#metal)" stroke="#1d3945" stroke-width="2.5"/>
      <path d="M52 34q12 12 24 0" stroke="#2b5561" stroke-width="4"/><path d="M54 27q10-9 20 0" stroke="#d6e9e6" stroke-opacity=".8" stroke-width="2"/>
      <path d="M52 76 64 82 76 76" stroke="#bdd0ca" stroke-width="2"/>
      {insignia}{equipment}
    '''


ASSETS["infantry"] = soldier_body()
ASSETS["engineer"] = soldier_body(True)

ASSETS["aircraft"] = shadow(64, 93, 43, 11) + '''
  <path d="M59 18q5-13 10 0l7 38 34 19-4 10-37-8-5 26-5-26-37 8-4-10 34-19Z" fill="url(#steel)" stroke="#182f3d" stroke-width="3"/>
  <path d="M64 12 79 70 64 84 49 70Z" fill="url(#metal)" stroke="#315766" stroke-width="1.5"/>
  <path d="M64 26q9 7 9 19l-9 14-9-14q0-12 9-19Z" fill="url(#glass)" stroke="#245669" stroke-width="2"/>
  <path d="m51 57-25 17 32-7m19-10 25 17-32-7" fill="url(#roofDark)" stroke="#96aeb3" stroke-width="1.5"/>
  <path d="m42 69-14 8m58-8 14 8M58 90l6 17 6-17" stroke="#58dbe0" stroke-width="3" filter="url(#softGlow)"/>
  <path d="M54 75 64 79 74 75" stroke="#f1c878" stroke-width="2.5"/>
'''

ASSETS["ore-crystal"] = shadow(64, 106, 38, 8) + '''
  <path d="M29 93 43 80 67 88 91 75 105 95 77 104 49 103Z" fill="#543c30" stroke="#7f6047" stroke-width="2"/>
  <path d="M35 88 44 48 59 84 50 98Z" fill="url(#ore)" stroke="#9b5928" stroke-width="2.5"/>
  <path d="M44 48 50 98 59 84Z" fill="#ba742d" opacity=".65"/>
  <path d="M53 86 66 27 79 83 66 101Z" fill="url(#gold)" stroke="#a5652e" stroke-width="2.5"/>
  <path d="M66 27v74l13-18Z" fill="#b96d2d" opacity=".7"/>
  <path d="M69 89 91 43 97 90 79 101Z" fill="url(#ore)" stroke="#92552d" stroke-width="2.5"/>
  <path d="M91 43 79 101 97 90Z" fill="#b76a2f" opacity=".65"/>
  <path d="m64 39-6 28m29-12-7 21M42 60l-3 17" stroke="#fff2c8" stroke-width="3" opacity=".7"/>
  <circle cx="67" cy="63" r="34" fill="url(#glow)" opacity=".35"/>
'''

ASSETS["faction-emblem"] = '''
  <path d="M64 5 112 27v40q0 37-48 56Q16 104 16 67V27Z" fill="#132d38" stroke="#8edbe0" stroke-width="4"/>
  <path d="M64 12 105 31v35q0 32-41 49Q23 98 23 66V31Z" fill="url(#roofDark)" stroke="#416b76" stroke-width="2"/>
  <path d="M64 23 92 37v24L64 77 36 61V37Z" fill="url(#metal)" stroke="#173a48" stroke-width="2.5"/>
  <path d="M64 33 82 42 64 53 46 42Z" fill="url(#glass)"/>
  <path d="M37 66 64 83 91 66 83 82 64 94 45 82Z" fill="url(#cyan)"/>
  <path d="M48 45v18l16 10 16-10V45L64 56Z" fill="#173c49" stroke="#83d9dc" stroke-width="2"/>
  <path d="M64 59v18" stroke="#63e4e8" stroke-width="3"/>
  <path d="M32 38 64 20l32 18" stroke="#b2eeee" stroke-opacity=".65" stroke-width="2"/>
'''

ASSETS["mcv"] = unit_shadow() + '''
  <path d="M28 44 45 34l8 11v44l-9 12-17-8Z" fill="#1b303a" stroke="#839ba4" stroke-width="2.5"/>
  <path d="M100 44 83 34l-8 11v44l9 12 17-8Z" fill="#1b303a" stroke="#839ba4" stroke-width="2.5"/>
  <path d="M29 53h15m-15 13h15m-15 13h15m-15 13h15m40-39h15M84 66h15M84 79h15M84 92h15" stroke="#58727b" stroke-width="3"/>
  <path d="M44 37 64 25 84 37l5 54-25 15-25-15Z" fill="url(#steel)" stroke="#1b3643" stroke-width="3"/>
  <path d="M48 39 64 30 80 39l2 18-18 10-18-10Z" fill="url(#roofDark)" stroke="#abc2c6" stroke-width="2"/>
  <path d="M53 44 64 37l11 7-2 10-9 6-9-6Z" fill="url(#glass)" stroke="#256176" stroke-width="1.5"/>
  <path d="M47 67 64 77 81 67v18L64 96 47 85Z" fill="url(#roof)" stroke="#1b3944" stroke-width="2"/>
  <path d="M52 69 64 76 76 69M52 84l12 8 12-8" stroke="#64e2e7" stroke-width="2.5"/>
  <path d="M38 29 49 23l6 7-11 6m40-7-11-6-6 7 11 6" fill="url(#metal)" stroke="#25414c" stroke-width="2"/>
  <path d="M59 73v11m10-11v11" stroke="#f2bf6f" stroke-width="2.5"/>
'''

ASSETS["helipad"] = base("url(#roofDark)") + '''
  <path d="M26 49 64 28 102 49 64 71Z" fill="#1d3540" stroke="#94b1b8" stroke-width="2.5"/>
  <path d="M34 49 64 33 94 49 64 65Z" fill="url(#steel)" stroke="#173a46" stroke-width="2"/>
  <path d="M43 49 64 38 85 49 64 60Z" fill="#284653" stroke="#63bac6" stroke-width="1.5"/>
  <path d="m51 43 13 7 13-7M51 55l13-7 13 7" stroke="#d4edef" stroke-width="3.3"/>
  <path d="M29 49 37 45m55 0 8 4m-71 0 8 4m55 0 8-4" stroke="#f3c56b" stroke-width="3"/>
  <circle cx="64" cy="29" r="3" fill="url(#cyan)" filter="url(#softGlow)"/>
  <path d="M27 73 43 82m58-9-16 9" stroke="#5ddce5" stroke-width="2.5"/>
'''

ASSETS["aa-tower"] = base("url(#roofDark)") + '''
  <path d="M47 45 64 35 81 45v26L64 81 47 71Z" fill="url(#steel)" stroke="#203b46" stroke-width="2.5"/>
  <path d="M47 45 64 55 81 45 64 35Z" fill="url(#metal)" stroke="#254652" stroke-width="2"/>
  <path d="M52 33 64 27 76 33v19L64 59 52 52Z" fill="#263f4b" stroke="#a2bdc2" stroke-width="2"/>
  <path d="M51 36 41 18l8-4 14 23m14-1 10-18-8-4-14 23" fill="url(#metal)" stroke="#1b3540" stroke-width="2.5"/>
  <path d="M40 18 49 14m30 0 9 4" stroke="#122936" stroke-width="4"/>
  <path d="M56 39 64 34l8 5-8 5Z" fill="url(#glass)"/>
  <path d="M54 65 64 71 74 65" stroke="#59dbe2" stroke-width="2.5"/>
  <path d="M29 65 43 73m56-8-14 8" stroke="#f2c470" stroke-width="2.5"/>
'''

ASSETS["obelisk"] = base("url(#roofDark)") + '''
  <path d="M64 7 77 44 73 78 64 86 55 78 51 44Z" fill="#172b38" stroke="#738b94" stroke-width="2.5"/>
  <path d="M64 7 77 44 64 59Z" fill="#455a67"/><path d="M64 7 51 44 64 59Z" fill="#273e4c"/>
  <path d="M51 44 64 59 77 44 73 78 64 86 55 78Z" fill="#253c48" stroke="#0b2430" stroke-width="2"/>
  <path d="M64 18 70 43 64 51 58 43Z" fill="#ff9d8b" stroke="#e26461" stroke-width="1.5" filter="url(#softGlow)"/>
  <path d="M64 23v29" stroke="#ffe1c9" stroke-width="2.2" opacity=".9"/>
  <path d="M56 63 64 68 72 63m-13 10 5 3 5-3" stroke="#f27970" stroke-width="2.5"/>
  <path d="m31 67 15 9m51-9-15 9" stroke="#ed8d78" stroke-width="2.5"/>
'''

ASSETS["warhead"] = base("url(#roofDark)") + '''
  <path d="M28 49 64 29 100 49 64 70Z" fill="#182f39" stroke="#9bb4bb" stroke-width="2.5"/>
  <path d="M37 49 64 34 91 49 64 64Z" fill="url(#steel)" stroke="#253e49" stroke-width="2"/>
  <path d="M47 49 64 40 81 49 64 59Z" fill="#132e39" stroke="#f28d77" stroke-width="2"/>
  <path d="M58 48 64 18 70 48 64 55Z" fill="url(#metal)" stroke="#182f3b" stroke-width="2"/>
  <path d="M60 34h8m-10 8h12" stroke="#ed8d75" stroke-width="2.5"/>
  <path d="M64 15 68 23h-8Z" fill="#ffac94" filter="url(#softGlow)"/>
  <path d="M35 44 42 40m44 0 7 4m-58 10 7 4m44 0 7-4" stroke="#f5c16b" stroke-width="3"/>
  <path d="M26 67 42 76m60-9-16 9" stroke="#ed8b78" stroke-width="2.5"/>
'''

ASSETS["ion-spire"] = base("url(#roofDark)") + '''
  <path d="M45 56 64 45 83 56v17L64 84 45 73Z" fill="url(#steel)" stroke="#1a3944" stroke-width="2.5"/>
  <path d="M45 56 64 66 83 56 64 45Z" fill="url(#metal)" stroke="#305663" stroke-width="1.5"/>
  <path d="M64 9 76 52 64 68 52 52Z" fill="#244451" stroke="#9dd2d6" stroke-width="2.5"/>
  <path d="M64 9 70 48 64 59 58 48Z" fill="url(#glass)" filter="url(#softGlow)"/>
  <path d="M64 18v34" stroke="#d6ffff" stroke-width="2" opacity=".85"/>
  <path d="M47 40 40 30m41 10 7-10M42 61l-9 5m53-5 9 5" stroke="#7ceaf0" stroke-width="2.2" opacity=".85"/>
  <circle cx="64" cy="10" r="4" fill="#caffff" filter="url(#softGlow)"/>
  <path d="M53 74 64 80 75 74" stroke="#68e2e8" stroke-width="2.4"/>
'''

ASSETS["guard-tower"] = base("url(#roofDark)") + '''
  <path d="M47 46 64 36 81 46v25L64 81 47 71Z" fill="url(#steel)" stroke="#183440" stroke-width="2.5"/>
  <path d="M47 46 64 56 81 46 64 36Z" fill="url(#metal)" stroke="#284c58" stroke-width="2"/>
  <path d="M42 35 64 23 86 35 64 47Z" fill="url(#roofDark)" stroke="#a9c1c5" stroke-width="2.5"/>
  <path d="M50 35 64 27 78 35 64 43Z" fill="url(#glass)" stroke="#225c6b" stroke-width="1.5"/>
  <path d="M60 34V13h8v21" fill="url(#metal)" stroke="#1b3642" stroke-width="2"/>
  <path d="M59 12h10" stroke="#172d39" stroke-width="4"/>
  <path d="M52 60 64 67 76 60" stroke="#5bdce5" stroke-width="2.2"/>
  <path d="m31 65 12 7m54-7-12 7" stroke="#f0c270" stroke-width="2.5"/>
'''


for name, body in ASSETS.items():
    (OUT / f"{name}.svg").write_text(svg(body), encoding="utf-8")

print(f"Generated {len(ASSETS)} SVG assets in {OUT}")
