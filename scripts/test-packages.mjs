import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "quiescent-consumer-"));
const packages = ["git", "server", "editor", "astro", "wiki"];
const archives = packages.map((name) => {
  const result = JSON.parse(
    execFileSync("npm", ["pack", "--json", "--pack-destination", directory], {
      cwd: resolve("code", name),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  return join(directory, result[0].filename);
});
writeFileSync(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }));
execFileSync(
  "npm",
  [
    "install",
    "--no-audit",
    "--no-fund",
    ...archives,
    "astro@7.3.5",
    "typescript@5.9.3",
    "@types/node@24",
  ],
  { cwd: directory, stdio: "inherit" },
);
for (const name of packages) {
  if (lstatSync(join(directory, "node_modules/@quiescent", name)).isSymbolicLink())
    throw new Error("Consumer must use tarballs");
}
writeFileSync(
  join(directory, "check.ts"),
  `import { createDocumentStore, defineDocumentConfig, configuredCollection, type DocumentRecord } from '@quiescent/server/documents';
import { astroDocuments } from '@quiescent/astro';
import { mountDocumentApp } from '@quiescent/editor';
import { documentImages } from '@quiescent/astro/images';
import { createForge } from '@quiescent/git';
const name = (document: DocumentRecord) => document.createdAt + '-' + document.id;
const config = defineDocumentConfig({repository:{provider:"github",owner:"writer",name:"content"},collections:{posts:{schema:true}}});
console.log(configuredCollection(config, "posts"));
console.log(createDocumentStore, astroDocuments, mountDocumentApp, documentImages, createForge, name);
`,
);
execFileSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    "nodenext",
    "--target",
    "es2022",
    "check.ts",
  ],
  { cwd: directory, stdio: "inherit" },
);
execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    "import schema from '@quiescent/server/config.schema.json' with {type:'json'}; if(schema.title!=='Quiescent configuration') throw Error('missing config schema'); import { documentCodec } from '@quiescent/server/documents'; const c=documentCodec(true); if(c.parse(c.stringify({frontmatter:{name:'Recipe'},body:'Mix'})).body!=='Mix') throw Error('roundtrip');",
  ],
  { cwd: directory, stdio: "inherit" },
);
const component = readFileSync(
  join(directory, "node_modules/@quiescent/astro/components/DocumentBody.astro"),
  "utf8",
);
if (!component.includes("imageComponent")) throw new Error("Missing shipped component");

mkdirSync(join(directory, "src/pages"), { recursive: true });
mkdirSync(join(directory, "src/components"), { recursive: true });
writeFileSync(
  join(directory, "src/components/Plain.astro"),
  `<img data-custom-image src={Astro.props.src} alt={Astro.props.alt} />`,
);
writeFileSync(
  join(directory, "src/pages/index.astro"),
  `---
import DocumentBody from '@quiescent/astro/components/DocumentBody.astro';
import Plain from '../components/Plain.astro';
---
<DocumentBody node={{type:'doc', content:[{type:'image',attrs:{src:'garden.png',alt:'Garden'}}]}} imageComponent={Plain} resolveImage={(name) => '/originals/' + name} />
`,
);
execFileSync(process.execPath, ["node_modules/astro/bin/astro.mjs", "build"], {
  cwd: directory,
  stdio: "inherit",
});

const html = readFileSync(join(directory, "dist/index.html"), "utf8");
if (!html.includes('src="/originals/garden.png"') || !html.includes("data-custom-image"))
  throw new Error("Custom image renderer needs metadata unexpectedly");
console.log(`Packed consumer and custom Astro rendering passed: ${directory}`);
