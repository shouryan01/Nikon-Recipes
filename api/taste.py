"""Taste helper: learn what a photographer likes from favorite recipes.

Stdlib only. Used two ways:
- `python3 api/taste.py --demo` prints an example for the hackathon video.
- Imported logic mirrors web/src/lib/taste.ts so the video story matches.
"""
import json
import sys

NUMERIC_KEYS = [
    "contrast", "saturation", "clarity", "shadows",
    "highlights", "blackLevel", "whiteLevel",
]


def average_favorites(favorites):
    """Average numeric Picture Control params across favorite settings dicts."""
    avg = {}
    for key in NUMERIC_KEYS:
        vals = [f[key] for f in favorites if isinstance(f.get(key), (int, float))]
        if vals:
            avg[key] = round(sum(vals) / len(vals), 1)
    return avg


def explain_taste(favorites, avg):
    """Plain-language summary: colors, shadows, and blend story."""
    lines = []
    lines.append(f"Based on {len(favorites)} favorites:")
    sat = avg.get("saturation", 0)
    if sat > 5:
        lines.append(f"- Colors: you like punch (avg saturation {sat}). New filter keeps saturation up.")
    elif sat < -5:
        lines.append(f"- Colors: you like muted film tones (avg saturation {sat}). New filter stays restrained.")
    else:
        lines.append(f"- Colors: you like near-neutral balance (avg saturation {sat}). New filter stays neutral.")
    sh = avg.get("shadows", 0)
    if sh > 5:
        lines.append(f"- Shadows: you like them lifted (+{sh}). New filter opens shadows similarly.")
    elif sh < -5:
        lines.append(f"- Shadows: you like them deep ({sh}). New filter keeps them moody.")
    else:
        lines.append("- Shadows: you keep them near default. New filter does the same.")
    lines.append("- Blend: averaged your favorite raw values, then nudged contrast +3 for a similar-but-unique look.")
    return "\n".join(lines)


def propose_filter(favorites, avg, user_note=""):
    """Build a new filter proposal from averaged favorites."""
    proposed = dict(avg)
    proposed["contrast"] = round(proposed.get("contrast", 0) + 3, 1)
    name = "Taste Blend 01"
    if user_note:
        name += f" ({user_note[:24]})"
    return {"name": name, "settings": proposed}


def main():
    demo = [
        {"contrast": 10, "saturation": 12, "clarity": 8, "shadows": 10, "highlights": -4, "blackLevel": -6, "whiteLevel": 4},
        {"contrast": 6, "saturation": 8, "clarity": 6, "shadows": 6, "highlights": -2, "blackLevel": -4, "whiteLevel": 2},
        {"contrast": 8, "saturation": 10, "clarity": 10, "shadows": 12, "highlights": -6, "blackLevel": -8, "whiteLevel": 6},
    ]
    if "--favorites" in sys.argv:
        idx = sys.argv.index("--favorites")
        with open(sys.argv[idx + 1]) as fh:
            demo = json.load(fh)
    avg = average_favorites(demo)
    print(explain_taste(demo, avg))
    print(json.dumps(propose_filter(demo, avg), indent=2))


if __name__ == "__main__":
    main()
