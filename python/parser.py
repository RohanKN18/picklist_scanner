#!/usr/bin/env python3
"""
Picklist Excel Parser — complete production version
Called by Node.js: python3 parser.py <file_path>
Outputs JSON to stdout, errors to stderr.
"""

import sys
import json
import os
import re


def clean_column_name(col):
    """Normalize column names: strip whitespace, remove special chars."""
    return str(col).strip()


def safe_value(val):
    """Convert any pandas/numpy value to a JSON-safe Python type."""
    # Handle NaN / NaT / None
    if val is None:
        return ""
    try:
        import math
        if isinstance(val, float) and math.isnan(val):
            return ""
    except Exception:
        pass

    # numpy int / float → native Python
    type_name = type(val).__name__
    if type_name in ("int64", "int32", "int16", "int8"):
        return int(val)
    if type_name in ("float64", "float32"):
        f = float(val)
        return "" if (f != f) else f   # NaN check via self-comparison
    if type_name in ("bool_", "bool"):
        return bool(val)
    if type_name == "Timestamp":
        return str(val)

    # Everything else → string
    return str(val).strip()


def detect_header_row(df_raw):
    """
    Some Excel files have metadata/title rows before the real header.
    Heuristic: find the first row where >50% of cells are non-empty strings.
    Returns the index of the header row (0-based), or 0 if unsure.
    """
    for i, row in df_raw.iterrows():
        non_empty = sum(1 for v in row if str(v).strip() not in ("", "nan", "None"))
        if non_empty >= max(2, len(row) * 0.5):
            return i
    return 0


def parse_excel(file_path):
    try:
        import pandas as pd
    except ImportError:
        return {"error": "pandas is not installed. Run: pip install pandas openpyxl xlrd"}

    print(f"Parsing file: {file_path}", file=sys.stderr)
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    ext = os.path.splitext(file_path)[1].lower()
    print(f"File extension: {ext}", file=sys.stderr)
    if ext not in (".xlsx", ".xls", ".xlsm", ".xlsb"):
        return {"error": f"Unsupported file type: '{ext}'. Use .xlsx or .xls"}

    # ── Read raw (no header) to detect actual header row ──
    try:
        engine = "openpyxl" if ext in (".xlsx", ".xlsm") else "xlrd"
        print(f"Using engine: {engine}", file=sys.stderr)
        df_raw = pd.read_excel(file_path, header=None, engine=engine)
    except Exception as e:
        return {"error": f"Cannot open file: {str(e)}"}

    print(f"Raw dataframe shape: {df_raw.shape}", file=sys.stderr)

    header_row_idx = detect_header_row(df_raw)

    # ── Re-read with correct header ──
    try:
        df = pd.read_excel(
            file_path,
            header=header_row_idx,
            engine=engine,
        )
    except Exception as e:
        return {"error": f"Failed to parse with detected header row {header_row_idx}: {str(e)}"}

    # ── Clean columns ──
    df.columns = [clean_column_name(c) for c in df.columns]

    # Drop columns with no name (e.g. "Unnamed: 3")
    df = df.loc[:, ~df.columns.str.match(r"^Unnamed")]

    # Drop fully empty rows
    df.dropna(how="all", inplace=True)
    df.reset_index(drop=True, inplace=True)

    if df.empty:
        return {"error": "No data rows found after removing empty rows."}

    columns = list(df.columns)

    # ── Build rows ──
    rows = []
    for _, row in df.iterrows():
        record = {col: safe_value(row[col]) for col in columns}
        rows.append(record)

    return {
        "columns": columns,
        "rows":    rows,
        "total":   len(rows),
        "sheets":  1,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 parser.py <file_path>", file=sys.stderr)
        sys.exit(1)

    result = parse_excel(sys.argv[1])

    if "error" in result:
        print(result["error"], file=sys.stderr)
        sys.exit(1)

    print(json.dumps(result, ensure_ascii=False, default=str))
