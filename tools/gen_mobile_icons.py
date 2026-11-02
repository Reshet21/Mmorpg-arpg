#!/usr/bin/env python3
"""Генератор растровых иконок PWA (только стандартная библиотека).

Запуск: python3 tools/gen_mobile_icons.py
Создаёт mobile/icon-192.png и mobile/icon-512.png — копию знака «семь Светочей»
для Android-манифеста и домашнего экрана iOS, где SVG-иконка не поддерживается.
Векторный исходник: mobile/icon.svg.
"""
from __future__ import annotations
import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "mobile"


class Canvas:
    def __init__(self, n: int) -> None:
        self.n = n
        self.buf = bytearray(n * n * 3)

    def put(self, x: float, y: float, rgb: tuple[int, int, int], a: float = 1.0) -> None:
        if a <= 0:
            return
        xi, yi = int(round(x)), int(round(y))
        if not (0 <= xi < self.n and 0 <= yi < self.n):
            return
        i = (yi * self.n + xi) * 3
        a = min(1.0, a)
        for k in range(3):
            old = self.buf[i + k]
            self.buf[i + k] = int(old + (rgb[k] - old) * a)

    def disc(self, cx: float, cy: float, r: float, rgb, a: float = 1.0) -> None:
        for y in range(max(0, int(cy - r - 1)), min(self.n, int(cy + r + 2))):
            for x in range(max(0, int(cx - r - 1)), min(self.n, int(cx + r + 2))):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                self.put(x, y, rgb, a * max(0.0, min(1.0, r + 0.7 - d)))

    def ring(self, cx, cy, r, w, rgb, a=1.0, dash: float = 0) -> None:
        for y in range(max(0, int(cy - r - w - 1)), min(self.n, int(cy + r + w + 2))):
            for x in range(max(0, int(cx - r - w - 1)), min(self.n, int(cx + r + w + 2))):
                d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                if abs(d - r) > w / 2:
                    continue
                if dash:
                    ang = math.atan2(y + 0.5 - cy, x + 0.5 - cx)
                    if int((ang + math.pi) / dash) % 2:
                        continue
                self.put(x, y, rgb, a * max(0.0, min(1.0, w / 2 + 0.7 - abs(d - r))))

    def line(self, x1, y1, x2, y2, w, rgb, a=1.0) -> None:
        steps = int(math.hypot(x2 - x1, y2 - y1) * 2) + 1
        for i in range(steps + 1):
            t = i / steps
            self.disc(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, rgb, a)

    def diamond(self, cx, cy, r, rgb, a=1.0) -> None:
        for y in range(max(0, int(cy - r)), min(self.n, int(cy + r + 1))):
            span = r - abs(y - cy)
            if span <= 0:
                continue
            for x in range(max(0, int(cx - span)), min(self.n, int(cx + span + 1))):
                self.put(x, y, rgb, a)

    def save(self, path: Path) -> None:
        n = self.n
        raw = b"".join(b"\x00" + bytes(self.buf[y * n * 3:(y + 1) * n * 3]) for y in range(n))

        def chunk(tag: bytes, data: bytes) -> bytes:
            return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

        png = (b"\x89PNG\r\n\x1a\n"
               + chunk(b"IHDR", struct.pack(">IIBBBBB", n, n, 8, 2, 0, 0, 0))
               + chunk(b"IDAT", zlib.compress(raw, 9))
               + chunk(b"IEND", b""))
        path.write_bytes(png)
        print(f"{path.relative_to(ROOT)}: {n}x{n}, {len(png):,} байт")


def draw(n: int) -> Canvas:
    c = Canvas(n)
    s = n / 512.0
    P = lambda v: v * s
    # фон: радиальный градиент + рамка
    for y in range(n):
        for x in range(n):
            d = math.hypot(x - P(256), y - P(215)) / P(360)
            t = max(0.0, min(1.0, d))
            c.put(x, y, (int(23 - 18 * t), int(48 - 38 * t), int(60 - 50 * t)))
    c.ring(P(256), P(256), P(240), P(3), (59, 107, 125), 0.65)
    c.ring(P(256), P(256), P(176), P(4), (110, 200, 220), 0.8)
    c.ring(P(256), P(256), P(146), P(2), (95, 208, 230), 0.35, dash=0.11)

    # шесть горящих Светочей
    ember = (255, 168, 84)
    for ang in (0, 60, 120, 180, 240, 300):
        a = math.radians(ang - 90)
        cx, cy = P(256), P(256)
        x1, y1 = cx + math.cos(a) * P(148), cy + math.sin(a) * P(148)
        x2, y2 = cx + math.cos(a) * P(196), cy + math.sin(a) * P(196)
        c.line(x1, y1, x2, y2, P(13), ember)
        c.disc(x2, y2, P(11), (255, 214, 130))
        c.disc(x2, y2, P(22), (255, 140, 70), 0.18)

    # седьмой, погасший
    c.disc(P(256), P(60), P(10), (66, 80, 90))
    c.line(P(244), P(48), P(268), P(72), P(4), (255, 138, 92), 0.85)

    # знак Рубежа
    c.diamond(P(256), P(256), P(88), (12, 32, 43))
    c.ring(P(256), P(256), P(79), P(5), (111, 210, 230), 0.9)
    c.diamond(P(256), P(256), P(60), ember)
    c.line(P(256), P(218), P(256), P(294), P(5), (255, 244, 214), 0.75)
    c.line(P(218), P(256), P(294), P(256), P(5), (255, 244, 214), 0.75)
    return c


if __name__ == "__main__":
    for size in (192, 512):
        draw(size).save(OUT / f"icon-{size}.png")
    print("Готово: иконки воспроизводимы без внешних зависимостей.")
