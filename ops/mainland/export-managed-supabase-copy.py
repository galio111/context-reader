#!/usr/bin/env python3
"""Create a psql-restorable, gzip-compressed data export without pg_dump."""

from __future__ import annotations

import argparse
import gzip
import json
import os
from pathlib import Path

import psycopg
from psycopg import sql


TABLES = (
    ("public", "account_profiles"),
    ("public", "quota_plans"),
    ("public", "quota_plan_limits"),
    ("public", "account_settings"),
    ("public", "user_entitlements"),
    ("public", "guest_identities"),
    ("public", "usage_counters"),
    ("public", "usage_actions"),
    ("public", "usage_executions"),
    ("public", "user_data_objects"),
    ("public", "admin_audit_logs"),
    ("public", "public_articles"),
    ("public", "public_explanations"),
    ("public", "public_article_translations"),
    ("auth", "instances"),
    ("auth", "users"),
    ("auth", "identities"),
    ("storage", "buckets"),
    ("storage", "objects"),
)


def read_database_url(path: Path) -> str:
    for raw in path.read_text(encoding="utf-8").splitlines():
        if raw.startswith("MANAGED_DATABASE_URL="):
            value = raw.split("=", 1)[1].strip()
            if value:
                return value
    raise SystemExit("MANAGED_DATABASE_URL is missing")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("connection_file", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    database_url = read_database_url(args.connection_file)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    partial = args.output.with_suffix(args.output.suffix + ".partial")
    counts: dict[str, int] = {}

    with psycopg.connect(database_url, autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute("set statement_timeout = 0")
            cursor.execute("set lock_timeout = '15s'")

        with gzip.open(partial, "wb", compresslevel=6) as output:
            output.write(b"\\set ON_ERROR_STOP on\n")
            output.write(b"SET session_replication_role = replica;\n")

            for schema, table in TABLES:
                with connection.cursor() as cursor:
                    cursor.execute(
                        """
                        select column_name
                        from information_schema.columns
                        where table_schema = %s and table_name = %s
                        order by ordinal_position
                        """,
                        (schema, table),
                    )
                    columns = [row[0] for row in cursor.fetchall()]
                    if not columns:
                        raise RuntimeError(f"source table is missing: {schema}.{table}")
                    cursor.execute(
                        sql.SQL("select count(*) from {}.{}").format(
                            sql.Identifier(schema), sql.Identifier(table)
                        )
                    )
                    counts[f"{schema}.{table}"] = cursor.fetchone()[0]

                column_sql = sql.SQL(", ").join(map(sql.Identifier, columns))
                copy_to = sql.SQL("COPY (SELECT {} FROM {}.{}) TO STDOUT WITH (FORMAT csv)").format(
                    column_sql, sql.Identifier(schema), sql.Identifier(table)
                )
                copy_from = sql.SQL("COPY {}.{} ({}) FROM STDIN WITH (FORMAT csv);\n").format(
                    sql.Identifier(schema), sql.Identifier(table), column_sql
                ).as_string(connection)
                output.write(copy_from.encode("utf-8"))
                with connection.cursor() as cursor:
                    with cursor.copy(copy_to) as copy:
                        while chunk := copy.read():
                            output.write(chunk)
                output.write(b"\\.\n")

            output.write(b"SET session_replication_role = origin;\n")

    os.replace(partial, args.output)
    args.output.with_suffix(args.output.suffix + ".manifest.json").write_text(
        json.dumps({"tables": counts}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"output": str(args.output), "tables": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
