import base64, pathlib
p = pathlib.Path("/mnt/sdc/digiworld/spikes/water-layering/colored.png")
b64 = base64.b64encode(p.read_bytes()).decode("ascii")
out = pathlib.Path("/mnt/sdc/digiworld/spikes/water-layering/tilesheet-data.js")
out.write_text(f"// Auto-generated: base64 of Kenney 1bitpack colored.png (real game tilesheet).\nwindow.TILESET_B64 = \"{b64}\";\n")
print("wrote", out, len(b64), "chars")
