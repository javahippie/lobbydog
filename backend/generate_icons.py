#!/usr/bin/env python3
"""Generate simple placeholder PNG icons for LobbyDog extension."""

import struct
import zlib


def create_png(size, bg_color=(30, 58, 95), text_color=(255, 255, 255)):
    """Create a simple PNG with a dog emoji-style icon."""

    # Create pixel data - simple circle with "L" letter
    pixels = []
    center = size / 2
    radius = size * 0.42

    for y in range(size):
        row = []
        for x in range(size):
            dx = x - center + 0.5
            dy = y - center + 0.5
            dist = (dx * dx + dy * dy) ** 0.5

            if dist <= radius:
                # Inside circle - check if we should draw "L"
                rx = (x - center) / radius
                ry = (y - center) / radius

                # Draw "L" shape
                in_l = (
                    (-0.35 <= rx <= -0.1 and -0.45 <= ry <= 0.45) or  # vertical bar
                    (-0.35 <= rx <= 0.35 and 0.2 <= ry <= 0.45)       # horizontal bar
                )

                if in_l:
                    row.extend(text_color)
                else:
                    row.extend(bg_color)
            else:
                row.extend((0, 0, 0, 0))  # transparent
                continue

            # Not transparent, add full alpha
        # Fix: rebuild with alpha channel
        pass

    # Simpler approach: create raw RGBA data
    raw_data = bytearray()
    for y in range(size):
        raw_data.append(0)  # filter byte
        for x in range(size):
            dx = x - center + 0.5
            dy = y - center + 0.5
            dist = (dx * dx + dy * dy) ** 0.5

            if dist <= radius:
                rx = (x - center) / radius
                ry = (y - center) / radius

                in_l = (
                    (-0.35 <= rx <= -0.1 and -0.45 <= ry <= 0.45) or
                    (-0.35 <= rx <= 0.35 and 0.2 <= ry <= 0.45)
                )

                if in_l:
                    raw_data.extend((*text_color, 255))
                else:
                    # Smooth edge
                    edge = max(0, min(1, (radius - dist) * 2))
                    alpha = int(edge * 255)
                    raw_data.extend((*bg_color, alpha))
            else:
                raw_data.extend((0, 0, 0, 0))

    # PNG encoding
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        crc = struct.pack(">I", zlib.crc32(chunk) & 0xFFFFFFFF)
        return struct.pack(">I", len(data)) + chunk + crc

    signature = b"\x89PNG\r\n\x1a\n"

    ihdr_data = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    ihdr = make_chunk(b"IHDR", ihdr_data)

    compressed = zlib.compress(bytes(raw_data))
    idat = make_chunk(b"IDAT", compressed)

    iend = make_chunk(b"IEND", b"")

    return signature + ihdr + idat + iend


if __name__ == "__main__":
    import os

    script_dir = os.path.dirname(os.path.abspath(__file__))

    for size in (16, 48, 128):
        png_data = create_png(size)
        path = os.path.join(script_dir, f"icon{size}.png")
        with open(path, "wb") as f:
            f.write(png_data)
        print(f"Created {path} ({len(png_data)} bytes)")
