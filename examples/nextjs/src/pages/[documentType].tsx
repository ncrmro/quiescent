import { GetStaticPaths, GetStaticProps } from "next";
import { getManifest } from "@quiescent/server";

export { default as default } from "../routes/Posts";

// TODO this should eventually be generated from the config.
export const DocumentTypes = ["posts", "guides", "recipes"] as const;

export const getStaticProps: GetStaticProps = async (context) => {
  const documentType = DocumentTypes.find(
    (d) => d === context.params?.documentType
  );
  if (!documentType)
    throw "Document type param doesn't match existing documents.";
  const manifest = await getManifest(documentType, "dynamic");
  return {
    props: { documentType, documents: manifest.documents },
  };
};

export const getStaticPaths: GetStaticPaths = async (context) => {
  return {
    paths: DocumentTypes.map((documentType) => ({
      params: {
        documentType,
      },
    })),
    fallback: "blocking",
  };
};
