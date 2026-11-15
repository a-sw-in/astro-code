import sqlite3, os

dbs = [
    r'c:\Users\aswin\Documents\nasa\astro-code-blue\backend\astro_code_blue.db',
    r'c:\Users\aswin\Documents\nasa\astro-code-blue\backend\astro_support.db',
]

for db_path in dbs:
    if not os.path.exists(db_path):
        print(f'Not found: {db_path}')
        continue
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = [row[0] for row in cur.fetchall()]
    for t in tables:
        cur.execute(f'DELETE FROM "{t}"')
        print(f'  Cleared: {t}')
    con.commit()
    con.close()
    print(f'Done: {os.path.basename(db_path)}')

print('All databases cleared!')
