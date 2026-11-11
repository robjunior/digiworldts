from pathlib import Path
import base64, pathlib
p = Path(__file__).resolve().parent / "colored.png")
b64 = base64.b64encode(p.read_bytes()).decode("ascii")
out = Path(__file__).resolve().parent / "tilesheet-data.js")
out.write_text(f"// Auto-generated: base64 of Kenney 1bitpack colored.png (real game tilesheet).\nwindow.TILESET_B64 = \"{b64}\";\n")
print("wrote", out, len(b64), "chars")
