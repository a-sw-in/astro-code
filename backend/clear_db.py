import sqlite3
import os

backend_dir = os.path.dirname(os.path.abspath(__file__))

dbs = [
    os.path.join(backend_dir, "astro_code_blue.db"),
    os.path.join(backend_dir, "astro_support.db"),
]

for db_path in dbs:
    if not os.path.exists(db_path):
        print(f"Not found: {db_path}")
        continue
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cur.fetchall()]
    for t in tables:
        if t.startswith("sqlite_"):
            continue
        cur.execute(f'DELETE FROM "{t}"')
        print(f"  Cleared: {t}")
    con.commit()
    con.close()
    print(f"Done: {os.path.basename(db_path)}")

print("All databases cleared!")
