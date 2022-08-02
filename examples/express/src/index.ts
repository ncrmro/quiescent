import express from "express";
import { getManifest } from "@quiescent/server";

const app = express();
const port = 5500;

app.get("/manifest", async (req, res) => {
  const manifest = await getManifest("posts", "dynamic");
  res.send(manifest);
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
