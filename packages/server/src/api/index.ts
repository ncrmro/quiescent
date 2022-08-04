import { getDocuments } from "../documents";

export async function apiGetDocuments<REQ, RES>(req: REQ, res: RES) {
  const documents = await getDocuments("posts", "dynamic");
}

export default function quiescentAPI<REQ, RES>(req: REQ, res: RES) {}
