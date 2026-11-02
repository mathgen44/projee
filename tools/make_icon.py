"""Génère l'icône de Projee (src/assets/icon.png, 1024 px), dans le style de celle de Jinglee.

    python tools/make_icon.py

Nécessite Pillow. electron-builder en tire les icônes Windows (.ico) et Mac (.icns).
"""
from pathlib import Path

from PIL import Image, ImageDraw

SIZE = 1024
SS = 4  # suréchantillonnage pour des bords lisses
U = SIZE * SS / 512  # le dessin est décrit sur une grille de 512

BG = (16, 18, 23)
BLUE = (48, 135, 224)
WHITE = (255, 255, 255)
STAND = (92, 99, 114)


def s(*v):
    return [round(x * U) for x in v]


def main():
    img = Image.new('RGB', (SIZE * SS, SIZE * SS), BG)
    d = ImageDraw.Draw(img)
    # Pied de l'écran de projection
    d.rounded_rectangle(s(248, 320, 264, 412), radius=round(4 * U), fill=STAND)
    d.rounded_rectangle(s(184, 400, 328, 418), radius=round(9 * U), fill=STAND)
    # Écran
    d.rounded_rectangle(s(84, 100, 428, 326), radius=round(20 * U), fill=BLUE)
    # Enrouleur en haut de l'écran
    d.rounded_rectangle(s(62, 84, 450, 108), radius=round(12 * U), fill=STAND)
    # Lecture
    d.polygon(s(222, 160, 222, 270, 316, 215), fill=WHITE)
    out = Path(__file__).resolve().parent.parent / 'src' / 'assets' / 'icon.png'
    out.parent.mkdir(parents=True, exist_ok=True)
    img.resize((SIZE, SIZE), Image.LANCZOS).save(out)
    print(out)


if __name__ == '__main__':
    main()
