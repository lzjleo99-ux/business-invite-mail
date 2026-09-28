#!/usr/bin/env python3
"""Parse xlsx/csv file and output rows as JSON to stdout.

Usage: python3 parse_xlsx.py <file_path>

Auto-detects format (.xlsx/.xls/.csv).
For xlsx: reads first sheet (or sheet named "Data" if present), first row is header.
For csv: reads first sheet, first row is header.
Outputs JSON array of row objects (key = header name, value = cell value).
Errors go to stderr, exit code 1 on failure.
"""

import json
import os
import sys


def _clean_value(val):
    if val is None:
        return None
    if isinstance(val, str):
        s = val.strip()
        return s if s else None
    return val


def parse_xlsx(file_path: str) -> list[dict]:
    try:
        from openpyxl import load_workbook
    except ImportError:
        print(
            "Error: openpyxl not installed. Run: pip install openpyxl",
            file=sys.stderr,
        )
        return _parse_xlsx_raw(file_path)

    try:
        wb = load_workbook(file_path, data_only=True, read_only=True)
    except Exception as e:
        print(f"Error loading workbook: {e}", file=sys.stderr)
        raise

    sheet_name = None
    if "Data" in wb.sheetnames:
        sheet_name = "Data"
    elif len(wb.sheetnames) > 0:
        sheet_name = wb.sheetnames[0]
    else:
        wb.close()
        raise ValueError("工作簿中没有工作表")

    ws = wb[sheet_name]
    rows_iter = ws.iter_rows(values_only=True)

    try:
        header_row = next(rows_iter)
    except StopIteration:
        wb.close()
        return []

    headers: list[str] = []
    for cell in header_row:
        if cell is None:
            headers.append("")
        else:
            headers.append(str(cell).strip())

    result: list[dict] = []
    for row in rows_iter:
        if row is None or all(
            c is None or str(c).strip() == "" for c in row
        ):
            continue

        row_obj: dict = {}
        for i, cell in enumerate(row):
            if i >= len(headers):
                break
            header = headers[i]
            if not header:
                continue
            row_obj[header] = _clean_value(cell)
        result.append(row_obj)

    wb.close()
    return result


def _parse_xlsx_raw(file_path: str) -> list[dict]:
    """Fallback: parse xlsx using only stdlib zipfile + xml."""
    import zipfile
    import xml.etree.ElementTree as ET

    NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    OFFICE_RELS_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    PKG_RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships"

    try:
        z = zipfile.ZipFile(file_path)
    except Exception as e:
        raise ValueError(f"无法打开文件 (不是有效的 xlsx/zip): {e}") from e

    shared_strings: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(f"{{{NS}}}si"):
            parts: list[str] = []
            for t in si.iter(f"{{{NS}}}t"):
                if t.text:
                    parts.append(t.text)
            shared_strings.append("".join(parts))

    wb_root = ET.fromstring(z.read("xl/workbook.xml"))
    sheets = wb_root.find(f"{{{NS}}}sheets")
    if sheets is None:
        raise ValueError("工作簿中没有工作表")

    sheet_elems = sheets.findall(f"{{{NS}}}sheet")
    target_sheet_name = None
    for s in sheet_elems:
        name = s.get("name", "")
        if name == "Data":
            target_sheet_name = name
            break
    if target_sheet_name is None and sheet_elems:
        target_sheet_name = sheet_elems[0].get("name", "")

    rels_root = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
    sheet_r_id = None
    for s in sheet_elems:
        name = s.get("name", "")
        if name == target_sheet_name:
            sheet_r_id = s.get(f"{{{OFFICE_RELS_NS}}}id")
            break

    sheet_path = None
    for rel in rels_root.findall(f"{{{PKG_RELS_NS}}}Relationship"):
        if rel.get("Id") == sheet_r_id:
            target = rel.get("Target", "")
            if target.startswith("/"):
                sheet_path = target.lstrip("/")
            else:
                sheet_path = f"xl/{target}"
            break

    if not sheet_path or sheet_path not in z.namelist():
        raise ValueError(f"找不到工作表: {target_sheet_name}")

    sheet_root = ET.fromstring(z.read(sheet_path))
    sheet_data = sheet_root.find(f"{{{NS}}}sheetData")
    if sheet_data is None:
        return []

    rows = sheet_data.findall(f"{{{NS}}}row")
    if not rows:
        return []

    def cell_value(cell):
        t = cell.get("t", "")
        v_elem = cell.find(f"{{{NS}}}v")
        if t == "inlineStr":
            is_elem = cell.find(f"{{{NS}}}is")
            if is_elem is None:
                return None
            parts: list[str] = []
            for t_elem in is_elem.iter(f"{{{NS}}}t"):
                if t_elem.text:
                    parts.append(t_elem.text)
            return "".join(parts) if parts else None
        if v_elem is None or v_elem.text is None:
            return None
        raw = v_elem.text
        if t == "s":
            idx = int(raw)
            return shared_strings[idx] if idx < len(shared_strings) else None
        if t == "n" or t == "":
            try:
                f = float(raw)
                if f == int(f):
                    return int(f)
                return f
            except ValueError:
                return raw
        return raw

    headers: list[str] = []
    first_row = rows[0]
    for c in first_row.findall(f"{{{NS}}}c"):
        val = cell_value(c)
        headers.append(str(val).strip() if val else "")

    result: list[dict] = []
    for row in rows[1:]:
        cells = row.findall(f"{{{NS}}}c")
        if not cells:
            continue
        all_empty = True
        row_obj: dict = {}
        for c in cells:
            r_ref = c.get("r", "")
            col_letters = "".join(ch for ch in r_ref if ch.isalpha())
            col_idx = 0
            for ch in col_letters:
                col_idx = col_idx * 26 + (ord(ch.upper()) - ord("A") + 1)
            col_idx -= 1
            if col_idx < 0 or col_idx >= len(headers):
                continue
            header = headers[col_idx]
            if not header:
                continue
            val = _clean_value(cell_value(c))
            if val is not None:
                all_empty = False
            row_obj[header] = val
        if not all_empty:
            result.append(row_obj)

    return result


def parse_csv(file_path: str) -> list[dict]:
    import csv

    try:
        with open(file_path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            result: list[dict] = []
            for row in reader:
                cleaned = {}
                all_empty = True
                for k, v in row.items():
                    key = k.strip() if k else ""
                    if not key:
                        continue
                    val = _clean_value(v)
                    if val is not None:
                        all_empty = False
                    cleaned[key] = val
                if not all_empty:
                    result.append(cleaned)
            return result
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="gbk") as f:
            reader = csv.DictReader(f)
            result: list[dict] = []
            for row in reader:
                cleaned = {}
                all_empty = True
                for k, v in row.items():
                    key = k.strip() if k else ""
                    if not key:
                        continue
                    val = _clean_value(v)
                    if val is not None:
                        all_empty = False
                    cleaned[key] = val
                if not all_empty:
                    result.append(cleaned)
            return result


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: parse_xlsx.py <file_path>", file=sys.stderr)
        return 1

    file_path = sys.argv[1]

    if not os.path.exists(file_path):
        print(f"Error: 文件不存在: {file_path}", file=sys.stderr)
        return 1

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        print("Error: 文件为空", file=sys.stderr)
        return 1

    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".csv":
            rows = parse_csv(file_path)
        elif ext in (".xlsx", ".xls"):
            rows = parse_xlsx(file_path)
        else:
            try:
                rows = parse_xlsx(file_path)
            except Exception:
                rows = parse_csv(file_path)

        json.dump(rows, sys.stdout, ensure_ascii=False)
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
