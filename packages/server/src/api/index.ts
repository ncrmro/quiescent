import documents from "../documents";

export function getDocuments<REQ, RES>(req: REQ, res: RES) {
  documents.get("posts", "dynamic");
}

export default function quiescentAPI<REQ, RES>(req: REQ, res: RES) {}
