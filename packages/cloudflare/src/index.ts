import * as Server from "@quiescent/server";
import Cloudflare from "cloudflare";

const { CF_EMAIL, CF_API_KEY } = process.env;
if (!CF_EMAIL || !CF_API_KEY) throw new Error("Cloudflare credentials required");

const cf = new Cloudflare({
  email: CF_EMAIL,
  key: CF_API_KEY
});

// https://api.cloudflare.com/#workers-kv-namespace-write-multiple-key-value-pairs
async function getDocuments(documentType: string,
                            mode: "dynamic" | "filesystem",
                            category?: string) {
  const docs = await Server.getDocuments(documentType, mode, category);
  await cf.enterpriseZoneWorkersKV.addMulti('test', 'namespace', [])
  console.log(docs);
}
