import csv
from itertools import islice

path='PARENTS_table_nir_lior.csv'
with open(path, 'r', encoding='utf-8', errors='replace') as f:
    reader = csv.reader(f)
    rows = list(islice(reader, 12))

print('First 12 rows, col0 values:')
for i, row in enumerate(rows):
    print(i, repr(row[0] if row else ''))
