import { readFileSync } from "node:fs";
import { createClient, type InValue, type ResultSet } from "@libsql/client";
import {
  type DocumentCacheDatabase,
  type DocumentCacheQuery,
  type DocumentCacheStatement,
  documentCacheIndexStatements,
  sqlDocumentCache,
} from "./document-cache-sql.ts";
/** Persistent local adapter; import this subpath only in Node/self-hosted runtimes. */
export function sqliteDocumentCache(options: { url: string; indexes?: string[] }) {
  if (!options.url.startsWith("file:"))
    throw new Error("Local document cache requires a file: SQLite URL");
  const client = createClient({ url: options.url });
  let initialized: Promise<void> | undefined;
  function ready() {
    initialized ??= client.executeMultiple(
      readFileSync(new URL("./documents-cache.schema.sql", import.meta.url), "utf8") +
        "\n" +
        documentCacheIndexStatements(options.indexes ?? []).join("\n"),
    );
    return initialized;
  }
  function result<T>(value: ResultSet): DocumentCacheQuery<T> {
    return { results: value.rows as unknown as T[], meta: { changes: value.rowsAffected } };
  }
  class Statement implements DocumentCacheStatement {
    args: InValue[] = [];
    constructor(readonly sql: string) {}
    bind(...values: unknown[]) {
      this.args = values as InValue[];
      return this;
    }
    async all<T>() {
      await ready();
      return result<T>(await client.execute({ sql: this.sql, args: this.args }));
    }
    async run() {
      return this.all<Record<string, unknown>>();
    }
  }
  const database: DocumentCacheDatabase = {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch<T>(statements: DocumentCacheStatement[]) {
      await ready();
      const batch = statements.map((statement) => {
        const value = statement as Statement;
        return { sql: value.sql, args: value.args };
      });
      return (await client.batch(batch, "write")).map((value) => result<T>(value));
    },
  };
  return {
    ...sqlDocumentCache(database),
    close() {
      client.close();
    },
  };
}
