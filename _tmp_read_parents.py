import pandas as pd

path = 'PARENTS.xlsx'
xl = pd.ExcelFile(path)
print('Sheets:', xl.sheet_names)
for sheet in xl.sheet_names:
    df = pd.read_excel(path, sheet_name=sheet, header=None)
    non_empty = df.dropna(how='all')
    print('\n===', sheet, '===')
    print('shape:', df.shape, 'non_empty_rows:', non_empty.shape[0])
    preview = non_empty.iloc[:15, :20]
    print(preview.to_string(index=False, header=False))
