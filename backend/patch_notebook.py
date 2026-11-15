import json

path = r'c:\Users\aswin\Documents\nasa\astro-code-blue\model\model.ipynb'
with open(path, 'r', encoding='utf-8') as f:
    nb = json.load(f)

src = nb['cells'][0]['source']

# Find the insertion point: after the INSUFFICIENT DATA line, before "Return ONLY valid JSON"
insert_after = None
return_line = None
for i, line in enumerate(src):
    if 'INSUFFICIENT DATA' in line and 'brief note' in line:
        insert_after = i
    if 'Return ONLY valid JSON' in line and 'structure' in line:
        return_line = i
        break

print(f"insert_after={insert_after}, return_line={return_line}")
print(f"insert_after line: {repr(src[insert_after])[:100]}")
print(f"return_line line: {repr(src[return_line])[:100]}")

# Insert the overview instruction between INSUFFICIENT DATA line and Return ONLY line
overview_instruction = (
    "Also write an 'overview' field: 4-6 sentence unified clinical synthesis covering 24h diurnal "
    "changes, 7-day weekly adaptation, and 30-day long-duration physiology in one report. "
    "Reference specific metric directions. Use authoritative flight surgeon language.\\n"
)
new_line = f'    "{overview_instruction}",\n'

# Find the blank line between insert_after and return_line
blank_line_idx = None
for i in range(insert_after + 1, return_line):
    if src[i].strip() == '"\\n",' or src[i].strip() == '"\\\\n",':
        blank_line_idx = i
        break

print(f"blank_line_idx={blank_line_idx}: {repr(src[blank_line_idx])[:80] if blank_line_idx else 'N/A'}")

# Insert after the INSUFFICIENT DATA line
src.insert(insert_after + 1, new_line)

# Also add "overview" key to the JSON structure template
# Find the line with  "24h": {{ right before direction_label
for i, line in enumerate(src):
    if '"24h": {{\\n' in line and i > insert_after:
        overview_json_line = '    "\\"overview\\": \\"4-6 sentence unified clinical synthesis covering 24h, 7d, and 30d. Reference specific metric directions. Flight surgeon language.\\",\\n",\n'
        src.insert(i, overview_json_line)
        print(f"Inserted overview JSON key at line {i}")
        break

# Bump max_new_tokens from 700 to 950
for i, line in enumerate(src):
    if 'max_new_tokens=700' in line:
        src[i] = line.replace('max_new_tokens=700', 'max_new_tokens=950')
        print(f"Bumped max_new_tokens at line {i}")
        break

nb['cells'][0]['source'] = src
with open(path, 'w', encoding='utf-8') as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print("Done! Notebook updated.")
