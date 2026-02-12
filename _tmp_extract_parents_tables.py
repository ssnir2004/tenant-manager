import pandas as pd

path = 'PARENTS.xlsx'

df = pd.read_excel(path, sheet_name=0, header=None)

# Find header positions containing 'חודש'
header_positions = []
for r in range(df.shape[0]):
    for c in range(df.shape[1]):
        val = df.iat[r, c]
        if isinstance(val, str) and val.strip() == 'חודש':
            header_positions.append((r, c))

if len(header_positions) < 2:
    raise SystemExit('Did not find two header positions for "חודש"')

# Use first two headers as two tables
header_positions.sort()
(h1_r, h1_c), (h2_r, h2_c) = header_positions[0], header_positions[1]

# Determine column ranges
first_start = h1_c
first_end = h2_c - 1
second_start = h2_c
second_end = df.shape[1] - 1

# Determine row range: from header row to last non-empty row within each table columns

def find_last_row(start_row, col_start, col_end):
    sub = df.iloc[start_row:, col_start:col_end+1]
    non_empty_rows = sub.dropna(how='all')
    if non_empty_rows.empty:
        return start_row
    last_idx = non_empty_rows.index.max()
    return last_idx

first_last = find_last_row(h1_r, first_start, first_end)
second_last = find_last_row(h2_r, second_start, second_end)

# Extract tables
first_table = df.iloc[h1_r:first_last+1, first_start:first_end+1].copy()
second_table = df.iloc[h2_r:second_last+1, second_start:second_end+1].copy()

# Write CSVs
first_table.to_csv('PARENTS_table_esther_michael.csv', index=False, header=False)
second_table.to_csv('PARENTS_table_nir_lior.csv', index=False, header=False)

print('Extracted:', 'PARENTS_table_esther_michael.csv', 'rows', first_table.shape[0], 'cols', first_table.shape[1])
print('Extracted:', 'PARENTS_table_nir_lior.csv', 'rows', second_table.shape[0], 'cols', second_table.shape[1])
