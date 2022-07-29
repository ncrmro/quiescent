import { GetStaticProps } from "next";

export { default as default } from "../../routes/Posts";

export const getStaticProps: GetStaticProps = async (context) => {
  // Importing server code
  const { getManifest } = await import("@quiescent/server");
  const posts = (await getManifest("posts", "dynamic")).documents;
  return {
    props: { posts },
  };
};
