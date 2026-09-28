// Generate Better Auth's SQLite schema and seed the one deliberately simple test login.
// Run from the repository root with: devenv shell -- bun code/web/scripts/writing-auth-schema.ts
import { Database } from "bun:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { TEST_WRITER_EMAIL } from "../src/writing/auth-client";
const database=new Database(":memory:");
const options={database,baseURL:"http://localhost:4180",secret:crypto.randomUUID()+crypto.randomUUID(),emailAndPassword:{enabled:true}};
const migrations=await getMigrations(options);
const schema=await migrations.compileMigrations();
await migrations.runMigrations();
const auth=betterAuth(options);
await auth.api.signUpEmail({body:{name:"Writer",email:TEST_WRITER_EMAIL,password:"quiescent-demo"}});
const quote=(value:unknown):string=>value===null?"NULL":typeof value==="number"?String(value):"'"+String(value).replaceAll("'","''")+"'";
let seed="";
for(const table of ["user","account"]){
  const rows=database.query(`SELECT * FROM "${table}"`).all() as Record<string,unknown>[];
  for(const row of rows) seed+=`INSERT INTO "${table}" (${Object.keys(row).map(k=>`"${k}"`).join(",")}) VALUES (${Object.values(row).map(quote).join(",")});\n`;
}
await Bun.write(new URL("../migrations/0001_writing_auth.sql",import.meta.url),schema+"\n"+seed);
console.log("Generated Better Auth schema and fixed test account.");
