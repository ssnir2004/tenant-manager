import pandas as pd

path = 'PARENTS.xlsx'
df = pd.read_excel(path, sheet_name=0, header=None)

hits = []
for r in range(df.shape[0]):
    for c in range(df.shape[1]):
        val = df.iat[r, c]
        if isinstance(val, str) and 'חודש' in val:
            hits.append((r, c, val))

print('Found חודש in', len(hits), 'cells')
for r, c, val in hits:
    print(f"Row {r+1}, Col {c+1}: {val}")
    row = df.iloc[r:r+2, max(c-5,0):c+20]
    print(row.to_string(index=False, header=False))
    print('---')
