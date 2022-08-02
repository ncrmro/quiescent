import { GetStaticPaths, GetStaticProps } from "next";
import { getManifest } from "@quiescent/server";

export { default as default } from "../routes/Posts";

export const getStaticProps: GetStaticProps = async (context) => {
  const documentType = context.params.documentType;
  if (typeof documentType === "string") {
    const manifest = await getManifest(documentType, "dynamic");

    return {
      props: { documentType, documents: manifest.documents },
    };
  }
};

export const getStaticPaths: GetStaticPaths = async (context) => {
  // Importing server code

  return {
    paths: ["posts", "jobs", "recipes"].map((documentType) => ({
      params: {
        documentType,
      },
    })),
    fallback: "blocking",
  };
};
